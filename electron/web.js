import dns from "node:dns/promises";
import net from "node:net";

// Web search (a SearXNG instance's JSON API) and page reading for the web_search and web_fetch tools.
const RESULTS = 6;
const READ = 3; // top results web_search reads, in parallel
const READ_TIMEOUT = 8_000; // a slow page is read as far as it got
const PASSAGES = 3; // per page
const PASSAGE = 350; // characters
const PAGE = 8_000; // characters of page text per call, like the other tools' output
const LOAD_TIMEOUT = 20_000;

// This Mac, the local network and reserved ranges: a page or the model mustn't reach llama-server, a router or similar.
// IPv4-mapped IPv6 addresses (::ffff:127.0.0.1) match the IPv4 rules.
const local = new net.BlockList();
for (const [a, p] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16], ["224.0.0.0", 3]]) local.addSubnet(a, p, "ipv4");
for (const [a, p] of [["::", 127], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]]) local.addSubnet(a, p, "ipv6");

// Why a URL may not be loaded, or "" when it may: http or https, to a host that only resolves to addresses on the internet.
export async function refusal(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return `${url} isn't a full web address.`;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "web_fetch only reads http and https pages.";
  const host = u.hostname.replace(/^\[|\]$/g, "");
  let addresses;
  try {
    addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await dns.lookup(host, { all: true });
  } catch {
    return `couldn't find ${host}.`;
  }
  if (addresses.some((a) => local.check(a.address, a.family === 6 ? "ipv6" : "ipv4"))) return "web_fetch only reads pages on the internet, not this Mac or the local network.";
  return "";
}
export const allowed = async (url) => !(await refusal(url));

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#x27;": "'", "&nbsp;": " " };
const clean = (s = "") => s.replace(/<[^>]+>/g, "").replace(/&(amp|lt|gt|quot|#39|#x27|nbsp);/g, (m) => ENTITIES[m]);

// Instant answers from the engines that give them, and the first infobox (often Wikipedia/Wikidata) with a few facts.
// Answers come as strings or as { answer, url }, depending on the engine and SearXNG version.
function instant({ answers = [], infoboxes = [] }) {
  const lines = answers.map((a) => clean(typeof a === "string" ? a : (a?.answer ?? ""))).filter(Boolean).map((a) => `Answer: ${a}`);
  for (const box of infoboxes.slice(0, 1)) {
    const link = box.urls?.[0]?.url;
    const facts = (box.attributes ?? []).slice(0, 5).map((a) => `${clean(a.label)}: ${clean(String(a.value ?? ""))}`);
    lines.push([`About ${clean(box.infobox)}${link ? ` (${link})` : ""}`, clean(box.content), ...facts].filter(Boolean).join("\n"));
  }
  return lines;
}

const STOP = new Set("the and for are was were what who how why when where with from that this have has into about latest best most much many does your you which there their".split(" "));

// The parts of a page that match the query: lines grouped into chunks of about 300 characters (so a heading stays with
// the numbers under it), scored by how many query words they contain, best first, returned in page order.
// Short lines without digits are dropped: menus and footers are short lines full of keywords, table rows have numbers.
// So are cookie banners. A chunk with a real sentence ranks above one made only of headings.
// ponytail: word overlap, not meaning; embeddings would find passages that say the same thing in other words
export function passages(text, query, max = PASSAGES) {
  const words = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].filter((w) => w.length > 2 && !STOP.has(w));
  const stems = words.map((w) => (w.length > 4 ? w.slice(0, -2) : w)); // salary → sala, matching salaries
  if (!stems.length) return [];
  const lines = text.split(/\n+/).map((l) => l.trim()).filter((l) => (l.length >= 30 || /\d/.test(l)) && !/cookie/i.test(l));
  const chunks = [];
  let chunk = "";
  for (const line of lines) {
    if (chunk && chunk.length + line.length > 300) chunks.push(chunk), (chunk = "");
    chunk = chunk ? `${chunk} · ${line}` : line;
  }
  if (chunk) chunks.push(chunk);
  return chunks
    .map((c, i) => ({ c, i, matches: stems.filter((s) => c.toLowerCase().includes(s)).length }))
    .filter(({ matches }) => matches > 0)
    .map(({ c, i, matches }) => ({ text: c.length > PASSAGE ? `${c.slice(0, PASSAGE)}…` : c, i, score: matches + (c.split(" · ").some((l) => l.length >= 80) ? 1 : 0) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map((c) => c.text);
}

// Instant answers, then the top results as numbered title, address and excerpt. base is the SearXNG address,
// e.g. http://127.0.0.1:8888. With load (the page reader's), the top results are also read, and each gets the passages
// that match the query, so one call returns content instead of only addresses.
// SearXNG only answers JSON when its settings.yml lists json under search.formats; otherwise it says 403.
export async function search(query, base, { signal, load } = {}) {
  if (!base) return "Error: web_search needs a SearXNG address. Add one in Settings.";
  let data;
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/search?${new URLSearchParams({ q: query, format: "json" })}`, { headers: { Accept: "application/json" }, signal });
    if (res.status === 403) return "Error: SearXNG refused JSON. Add json under search.formats in its settings.yml (see Photon's README).";
    if (res.status === 429) return "Error: SearXNG's rate limit was reached. Turn off its limiter in settings.yml, or try again in a moment.";
    if (!res.ok) return `Error: SearXNG answered HTTP ${res.status}.`;
    data = await res.json();
  } catch (e) {
    return signal?.aborted ? "Stopped by the user." : `Error: couldn't reach SearXNG at ${base} (${e.cause?.code ?? e.message}). Is it running?`;
  }
  const results = (data.results ?? []).slice(0, RESULTS);
  const top = instant(data);
  if (!results.length && !top.length) return "No results.";
  const read = load
    ? await Promise.all(results.slice(0, READ).map((r) => load(r.url, { signal, timeout: READ_TIMEOUT }).catch((e) => ({ error: e.message }))))
    : [];
  if (signal?.aborted) return "Stopped by the user.";
  const listed = results.map((r, i) => {
    const entry = `${i + 1}. ${clean(r.title)}\n${r.url}\n${clean(r.content)}`;
    const page = read[i];
    if (!page) return entry;
    const found = page.error || page.status >= 400 ? null : passages(page.text, query);
    if (!found) return `${entry}\n(Photon couldn't read this page${page.status >= 400 ? `: HTTP ${page.status}` : ""}.)`;
    return found.length ? `${entry}\nFrom the page:\n${found.map((p) => `- ${p}`).join("\n")}` : entry;
  });
  return [...top, ...listed].join("\n\n");
}

// The page's text from offset, with a note when there's more.
export function pageText({ title, url, status, text }, offset = 0) {
  text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const part = text.slice(offset, offset + PAGE);
  const rest = text.length - offset - part.length;
  const head = [title, url, status >= 400 ? `HTTP ${status}` : ""].filter(Boolean).join("\n");
  return `${head}\n\n${part || "(no text)"}${rest > 0 ? `\n\n[${rest} more characters: call web_fetch again with offset ${offset + part.length}]` : ""}`;
}

// Loads pages in a hidden window with a session of its own, so they don't see Photon's cookies or storage,
// can't download, open windows, play sound or ask for permissions. Images, media and fonts are skipped: only text is read.
// Every request, redirects included, is checked with allowed().
// load(url) gives { title, url, status, text } or { error }; read(url) gives web_fetch's result.
// ponytail: Chromium resolves DNS again after the check, so DNS rebinding could reach a local address; proxy requests through Node if that matters
export function createPageReader({ BrowserWindow, session }) {
  const ses = session.fromPartition("web-fetch"); // in memory: nothing is kept after Photon quits
  ses.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
  ses.on("will-download", (e) => e.preventDefault());
  ses.webRequest.onBeforeRequest((details, cb) => {
    if (["image", "media", "font", "object"].includes(details.resourceType)) return cb({ cancel: true });
    allowed(details.url).then((ok) => cb({ cancel: !ok }));
  });

  async function load(url, { signal, timeout = LOAD_TIMEOUT } = {}) {
    const refused = await refusal(url);
    if (refused) return { error: refused };
    const win = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true, images: false, backgroundThrottling: false } });
    win.webContents.setAudioMuted(true);
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    let status = 0;
    win.webContents.on("did-navigate", (_e, _url, code) => (status = code));
    const stop = new Promise((resolve) => signal?.addEventListener("abort", resolve, { once: true }));
    try {
      // a slow page is read as far as it got
      const loaded = win.loadURL(url).then(() => null, (e) => e);
      const error = await Promise.race([loaded, stop.then(() => "stopped"), new Promise((r) => setTimeout(r, timeout, null))]);
      if (signal?.aborted) return { error: "Stopped by the user." };
      // blocked by the request check above: a redirect or the page itself led to a local address
      if (error && !status) return { error: `couldn't load ${url} (${/ERR_BLOCKED_BY_CLIENT/.test(error.message) ? "it led to an address on this Mac or the local network, which web_fetch doesn't read" : error.message})` };
      await new Promise((r) => setTimeout(r, 500)); // let scripts render
      const page = await win.webContents.executeJavaScript("({ title: document.title, text: document.body ? document.body.innerText : '' })");
      return { ...page, url: win.webContents.getURL(), status };
    } catch (e) {
      return { error: `couldn't read ${url} (${e.message})` };
    } finally {
      win.destroy();
    }
  }

  async function read(url, { offset = 0, signal } = {}) {
    const page = await load(url, { signal });
    if (page.error) return page.error === "Stopped by the user." ? page.error : `Error: ${page.error}${/[.)]$/.test(page.error) ? "" : "."}`;
    return pageText(page, offset);
  }

  return { load, read };
}
