import assert from "node:assert/strict";
import http from "node:http";
import { allowed, pageText, passages, refusal, search } from "./web.js";

// only http(s) to the internet
for (const url of ["http://localhost:1420", "http://127.0.0.1:8080", "http://10.0.0.1", "http://192.168.1.1", "http://169.254.169.254/latest", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://0.0.0.0", "file:///etc/passwd", "javascript:alert(1)", "not a url"])
  assert.equal(await allowed(url), false, url);
assert.equal(await allowed("https://1.1.1.1/"), true);
assert.match(await refusal("https://no-such-host.invalid/"), /^couldn't find no-such-host\.invalid/);
assert.match(await refusal("http://[::1]/"), /not this Mac or the local network/);

// search: asks SearXNG for JSON, results come back numbered without markup, at most 6
let seen;
let status = 200;
const server = http.createServer((req, res) => {
  seen = new URL(req.url, "http://x");
  if (status !== 200) return res.writeHead(status).end();
  const more = Array.from({ length: 8 }, (_, i) => ({ title: `R${i}`, url: `https://r${i}.example/`, content: "" }));
  res.writeHead(200, { "Content-Type": "application/json" }).end(
    JSON.stringify({ results: [{ title: "Photon &amp; <b>friends</b>", url: "https://a.example/", content: "It&#39;s fast" }, ...more] }),
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const found = await search("local llm", base);
assert.match(found, /^1\. Photon & friends\nhttps:\/\/a\.example\/\nIt's fast\n\n2\. R0\n/);
assert.match(found, /\n6\. R4\nhttps:\/\/r4\.example\/\n$/);
assert.equal(seen.pathname, "/search");
assert.equal(seen.searchParams.get("q"), "local llm");
assert.equal(seen.searchParams.get("format"), "json");
status = 403;
assert.match(await search("x", base), /refused JSON/);
server.close();
assert.match(await search("x", ""), /needs a SearXNG address/);
assert.match(await search("x", base), /couldn't reach SearXNG at http.* \(E[A-Z]+\)\. Is it running\?/);

// passages: chunks that share the most query words, in page order; menus dropped, number rows kept, plurals matched
const page2 = [
  "Salaries", "Jobs", "Software Engineer Salary", // a menu: short lines without digits
  "Google pays its software engineers more than most companies, according to salaries reported this year by employees.",
  "L3 · $189K · base $142K",
  "Our office in Mountain View has a large campus with many restaurants, gyms and other facilities for staff to use.",
  "Senior software engineers at Google (L5) report a median total compensation of $395K, including stock grants.",
].join("\n");
const picked = passages(page2, "latest Google software engineer salary");
assert.equal(picked.length, 2);
assert.match(picked[0], /^Google pays its software engineers .* · L3 · \$189K · base \$142K/);
assert.match(picked[1], /L5\) report a median total compensation of \$395K/);
assert.ok(!picked.join(" ").includes("Salaries · Jobs"));
assert.deepEqual(passages(page2, "the and"), []); // only stop words
// a sentence beats a heading with the same words; cookie banners are dropped
const ranked = passages("Google Software Engineer Salary Guide 2026 · Updated today\n" + "x".repeat(400) + "\nWe use cookies to show Google software engineer salary ads and analyse our traffic on this site.\n" + "y".repeat(400) + "\nAt Google, a software engineer at L4 earns a salary of about $250K a year in total, including stock.", "Google software engineer salary", 1);
assert.match(ranked[0], /^At Google, a software engineer at L4/);
assert.ok(passages("x".repeat(30) + " salary " + "y".repeat(500), "salary")[0].endsWith("…"));

// web_search with reading: instant answers first, passages under the pages it read, a note for pages it couldn't
const rich = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" }).end(
    JSON.stringify({
      answers: ["42", { answer: "Six point two miles", url: "https://x.example/" }],
      infoboxes: [{ infobox: "Google", content: "Google LLC is an American technology company.", urls: [{ url: "https://en.wikipedia.org/wiki/Google" }], attributes: [{ label: "Inception", value: "1998" }] }],
      results: [
        { title: "Levels", url: "https://levels.example/google", content: "Salaries at Google" },
        { title: "Glassdoor", url: "https://glassdoor.example/", content: "Blocked" },
        { title: "Down", url: "https://down.example/", content: "Gone" },
        { title: "Not read", url: "https://fourth.example/", content: "Fourth" },
      ],
    }),
  );
});
await new Promise((r) => rich.listen(0, "127.0.0.1", r));
const loaded = [];
const load = async (url) => {
  loaded.push(url);
  if (url.includes("levels")) return { title: "Levels", url, status: 200, text: page2 };
  if (url.includes("glassdoor")) return { title: "Just a moment", url, status: 403, text: "Humans only" };
  return { error: "couldn't load it" };
};
const withPages = await search("Google software engineer salary", `http://127.0.0.1:${rich.address().port}`, { load });
assert.deepEqual(loaded, ["https://levels.example/google", "https://glassdoor.example/", "https://down.example/"]); // the top 3 only
assert.match(withPages, /^Answer: 42\n\nAnswer: Six point two miles\n\nAbout Google \(https:\/\/en\.wikipedia\.org\/wiki\/Google\)\nGoogle LLC is an American technology company\.\nInception: 1998\n\n1\. Levels/);
assert.match(withPages, /1\. Levels\nhttps:\/\/levels\.example\/google\nSalaries at Google\nFrom the page:\n- Google pays its software engineers/);
assert.match(withPages, /2\. Glassdoor\nhttps:\/\/glassdoor\.example\/\nBlocked\n\(Photon couldn't read this page: HTTP 403\.\)/);
assert.match(withPages, /3\. Down\nhttps:\/\/down\.example\/\nGone\n\(Photon couldn't read this page\.\)/);
assert.match(withPages, /4\. Not read\nhttps:\/\/fourth\.example\/\nFourth$/);
const listOnly = await search("Google software engineer salary", `http://127.0.0.1:${rich.address().port}`);
assert.ok(!listOnly.includes("From the page") && !listOnly.includes("couldn't read"));
rich.close();

// page text: tidied, read in parts
const page = { title: "T", url: "https://a.example/", status: 200, text: "a  \n\n\n\nb" + "x".repeat(9_000) };
const first = pageText(page);
assert.match(first, /^T\nhttps:\/\/a\.example\/\n\na\n\nbx/);
assert.match(first, /\[1004 more characters: call web_fetch again with offset 8000\]$/);
assert.ok(!pageText(page, 8000).includes("more characters"));
assert.match(pageText({ ...page, status: 404, text: "" }), /^T\nhttps:\/\/a\.example\/\nHTTP 404\n\n\(no text\)$/);

console.log("web: ok");
