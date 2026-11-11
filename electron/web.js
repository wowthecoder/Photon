import dns from "node:dns/promises";
import net from "node:net";

// Web search (a SearXNG instance's JSON API) and page reading for the web_search and web_fetch tools.
const RESULTS = 6;
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

// Returns the top results as numbered title, address and excerpt. base is the SearXNG address, e.g. http://127.0.0.1:8888.
// SearXNG only answers JSON when its settings.yml lists json under search.formats; otherwise it says 403.
export async function search(query, base, { signal } = {}) {
  if (!base) return "Error: web_search needs a SearXNG address. Add one in Settings.";
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/search?${new URLSearchParams({ q: query, format: "json" })}`, { headers: { Accept: "application/json" }, signal });
    if (res.status === 403) return "Error: SearXNG refused JSON. Add json under search.formats in its settings.yml (see Photon's README).";
    if (res.status === 429) return "Error: SearXNG's rate limit was reached. Turn off its limiter in settings.yml, or try again in a moment.";
    if (!res.ok) return `Error: SearXNG answered HTTP ${res.status}.`;
    const results = (await res.json()).results ?? [];
    if (!results.length) return "No results.";
    return results.slice(0, RESULTS).map((r, i) => `${i + 1}. ${clean(r.title)}\n${r.url}\n${clean(r.content)}`).join("\n\n");
  } catch (e) {
    return signal?.aborted ? "Stopped by the user." : `Error: couldn't reach SearXNG at ${base} (${e.cause?.code ?? e.message}). Is it running?`;
  }
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
// ponytail: Chromium resolves DNS again after the check, so DNS rebinding could reach a local address; proxy requests through Node if that matters
export function createPageReader({ BrowserWindow, session }) {
  const ses = session.fromPartition("web-fetch"); // in memory: nothing is kept after Photon quits
  ses.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
  ses.on("will-download", (e) => e.preventDefault());
  ses.webRequest.onBeforeRequest((details, cb) => {
    if (["image", "media", "font", "object"].includes(details.resourceType)) return cb({ cancel: true });
    allowed(details.url).then((ok) => cb({ cancel: !ok }));
  });

  return async function read(url, { offset = 0, signal, timeout = LOAD_TIMEOUT } = {}) {
    const refused = await refusal(url);
    if (refused) return `Error: ${refused}`;
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
      if (signal?.aborted) return "Stopped by the user.";
      // blocked by the request check above: a redirect or the page itself led to a local address
      if (error && !status) return `Error: couldn't load ${url} (${/ERR_BLOCKED_BY_CLIENT/.test(error.message) ? "it led to an address on this Mac or the local network, which web_fetch doesn't read" : error.message}).`;
      await new Promise((r) => setTimeout(r, 500)); // let scripts render
      const page = await win.webContents.executeJavaScript("({ title: document.title, text: document.body ? document.body.innerText : '' })");
      return pageText({ ...page, url: win.webContents.getURL(), status }, offset);
    } catch (e) {
      return `Error: couldn't read ${url} (${e.message}).`;
    } finally {
      win.destroy();
    }
  };
}
