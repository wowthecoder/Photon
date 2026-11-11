import assert from "node:assert/strict";
import http from "node:http";
import { allowed, pageText, refusal, search } from "./web.js";

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

// page text: tidied, read in parts
const page = { title: "T", url: "https://a.example/", status: 200, text: "a  \n\n\n\nb" + "x".repeat(9_000) };
const first = pageText(page);
assert.match(first, /^T\nhttps:\/\/a\.example\/\n\na\n\nbx/);
assert.match(first, /\[1004 more characters: call web_fetch again with offset 8000\]$/);
assert.ok(!pageText(page, 8000).includes("more characters"));
assert.match(pageText({ ...page, status: 404, text: "" }), /^T\nhttps:\/\/a\.example\/\nHTTP 404\n\n\(no text\)$/);

console.log("web: ok");
