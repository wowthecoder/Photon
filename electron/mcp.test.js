import assert from "node:assert/strict";
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createMcp } from "./mcp.js";

// a stand-in for a remote connector: one read-only tool, one that writes, bearer auth
const server = http.createServer(async (req, res) => {
  if (req.headers.authorization !== "Bearer good") return res.writeHead(401).end();
  const mcp = new McpServer({ name: "stub", version: "1" });
  mcp.registerTool("shout", { description: "Uppercase", inputSchema: { text: z.string() }, annotations: { readOnlyHint: true } }, ({ text }) => ({
    content: [{ type: "text", text: text.toUpperCase() }],
  }));
  mcp.registerTool("create_issue", { description: "Create", inputSchema: { title: z.string() } }, () => ({ content: [{ type: "text", text: "nope" }], isError: true }));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await mcp.connect(transport);
  await transport.handleRequest(req, res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));

const changes = [];
const mcp = createMcp((list) => changes.push(list[0].status), [{ id: "stub", name: "Stub", url: `http://127.0.0.1:${server.address().port}/mcp`, tokenUrl: "" }]);

assert.equal(await mcp.connect("stub", "bad"), false);
assert.equal(mcp.list()[0].status, "error");
assert.deepEqual(mcp.tools(), []);

assert.equal(await mcp.connect("stub", "good"), true);
assert.deepEqual(changes.slice(-2), ["connecting", "on"]);
assert.equal(mcp.list()[0].toolCount, 2);
assert.deepEqual(
  mcp.tools().map((t) => [t.name, t.readOnly]),
  [["stub_shout", true], ["stub_create_issue", false]],
);
assert.equal(await mcp.call("stub_shout", { text: "hi" }), "HI");
assert.equal(await mcp.call("stub_create_issue", { title: "x" }), "Error: nope");

mcp.disconnect("stub");
assert.equal(mcp.list()[0].status, "off");
assert.match(await mcp.call("stub_shout", { text: "hi" }), /disconnected/);

server.close();
console.log("mcp ok");
