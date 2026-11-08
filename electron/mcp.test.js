import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createMcp } from "./mcp.js";

// A stand-in for GitHub: OAuth metadata, an authorize page that approves (or denies) at once,
// a token endpoint that checks the client secret and PKCE, and an MCP endpoint behind a bearer token.
let deny = false;
const authorizeRequests = [];
const challenges = new Map();
const json = (res, body, status = 200) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
const server = http.createServer(async (req, res) => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const url = new URL(req.url, base);
  if (url.pathname === "/.well-known/oauth-protected-resource/mcp") return json(res, { resource: `${base}/mcp`, authorization_servers: [base] });
  if (url.pathname === "/.well-known/oauth-authorization-server")
    return json(res, { issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"] });
  if (url.pathname === "/authorize") {
    authorizeRequests.push(Object.fromEntries(url.searchParams));
    const back = new URL(url.searchParams.get("redirect_uri"));
    back.searchParams.set("state", url.searchParams.get("state"));
    if (deny) back.searchParams.set("error", "access_denied");
    else back.searchParams.set("code", "code1"), challenges.set("code1", url.searchParams.get("code_challenge"));
    return res.writeHead(302, { Location: back.href }).end();
  }
  if (url.pathname === "/token") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const p = new URLSearchParams(body);
    const pkce = createHash("sha256").update(p.get("code_verifier") ?? "").digest("base64url");
    const ok = p.get("client_id") === "app" && p.get("client_secret") === "shh" && pkce === challenges.get(p.get("code"));
    return ok ? json(res, { access_token: "good", token_type: "bearer" }) : json(res, { error: "invalid_grant" }, 400);
  }
  if (req.headers.authorization !== "Bearer good")
    return res.writeHead(401, { "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` }).end();
  const mcp = new McpServer({ name: "stub", version: "1" });
  mcp.registerTool("shout", { description: "Uppercase", inputSchema: { text: z.string() }, annotations: { readOnlyHint: true } }, ({ text }) => ({ content: [{ type: "text", text: text.toUpperCase() }] }));
  mcp.registerTool("create_issue", { description: "Create", inputSchema: { title: z.string() } }, () => ({ content: [{ type: "text", text: "nope" }], isError: true }));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await mcp.connect(transport);
  await transport.handleRequest(req, res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const connectors = [{ id: "stub", name: "Stub", description: "", url: `http://127.0.0.1:${server.address().port}/mcp`, scope: "repo read:user", oauthApp: "stubApp" }];

// the "browser": follows the authorize redirect back to Photon's loopback callback
let browserOpened = 0;
const openUrl = async (url) => {
  browserOpened++;
  const res = await fetch(url, { redirect: "manual" });
  await fetch(res.headers.get("location"));
};
const saved = new Map();
const store = { get: (id) => saved.get(id), set: (id, data) => (data ? saved.set(id, data) : saved.delete(id)) };
let signedIn = 0;
const make = (opts = {}) => createMcp({ onChange: () => {}, store, clients: { stubApp: { client_id: "app", client_secret: "shh" } }, openUrl, onSignedIn: () => signedIn++, connectors, ...opts });

// no OAuth app configured
const unset = make({ clients: {} });
await unset.connect("stub");
assert.equal(unset.list()[0].setUp, false);
assert.match(unset.list()[0].error, /needs an OAuth app/);

// sign in through the browser, then use the tools
const mcp = make();
await mcp.connect("stub");
assert.equal(mcp.list()[0].status, "on", mcp.list()[0].error);
assert.equal(signedIn, 1);
assert.equal(authorizeRequests[0].scope, "repo read:user");
assert.equal(authorizeRequests[0].code_challenge_method, "S256");
assert.equal(saved.get("stub").tokens.access_token, "good");
assert.deepEqual(mcp.tools().map((t) => [t.name, t.readOnly]), [["stub_shout", true], ["stub_create_issue", false]]);
assert.equal(await mcp.call("stub_shout", { text: "hi" }), "HI");
assert.equal(await mcp.call("stub_create_issue", { title: "x" }), "Error: nope");

// next launch: the saved tokens connect without the browser
const relaunched = make();
await relaunched.resume("stub");
assert.equal(relaunched.list()[0].status, "on");
assert.equal(browserOpened, 1);

// revoked tokens: asks to connect again instead of opening the browser
saved.set("stub", { tokens: { access_token: "revoked", token_type: "bearer" } });
const revoked = make();
await revoked.resume("stub");
assert.match(revoked.list()[0].error, /signed out/);
assert.equal(browserOpened, 1);

// the user denies access in the browser
deny = true;
await mcp.connect("stub");
assert.equal(mcp.list()[0].status, "error");
assert.match(mcp.list()[0].error, /access_denied/);
deny = false;

// the user cancels while the browser is open
const waiting = make({ openUrl: () => {} });
const pending = waiting.connect("stub");
await new Promise((r) => setTimeout(r, 200));
assert.equal(waiting.list()[0].status, "connecting");
waiting.disconnect("stub");
await pending;
assert.equal(waiting.list()[0].status, "off");

// disconnecting forgets the sign-in
mcp.disconnect("stub");
assert.equal(saved.has("stub"), false);
assert.match(await mcp.call("stub_shout", { text: "hi" }), /disconnected/);

relaunched.disconnect("stub");
server.close();
console.log("mcp ok");
