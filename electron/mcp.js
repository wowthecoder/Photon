import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const CONNECTORS = [
  {
    id: "github",
    name: "GitHub",
    url: "https://api.githubcopilot.com/mcp/",
    tokenUrl: "https://github.com/settings/personal-access-tokens/new",
  },
];

const textOf = (result) =>
  (result.isError ? "Error: " : "") +
  (result.content ?? []).map((c) => (c.type === "text" ? c.text : c.type === "resource" ? (c.resource.text ?? `[${c.resource.uri}]`) : `[${c.type}]`)).join("\n");

// One MCP client per connected connector, authenticated with a bearer token.
// The model sees each tool as <connector id>_<tool name>.
// ponytail: PAT only; OAuth (SDK auth() + loopback redirect) is phase 2
export function createMcp(onChange, connectors = CONNECTORS) {
  const live = new Map(); // id -> { status, error?, client?, tools? }

  const list = () =>
    connectors.map(({ id, name, tokenUrl }) => {
      const s = live.get(id);
      return { id, name, tokenUrl, status: s?.status ?? "off", error: s?.error, toolCount: s?.tools?.length ?? 0 };
    });
  const set = (id, s) => (s ? live.set(id, s) : live.delete(id), onChange(list()));

  async function connect(id, token) {
    const def = connectors.find((c) => c.id === id);
    if (!def) throw new Error(`Unknown connector ${id}`);
    disconnect(id);
    set(id, { status: "connecting" });
    const client = new Client({ name: "Photon", version: "0.1.0" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(def.url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
      const tools = [];
      let cursor;
      do {
        const page = await client.listTools(cursor ? { cursor } : {});
        tools.push(...page.tools);
        cursor = page.nextCursor;
      } while (cursor);
      if (live.get(id)?.status !== "connecting") return client.close(); // disconnected meanwhile
      set(id, { status: "on", client, tools });
    } catch (e) {
      client.close().catch(() => {});
      set(id, { status: "error", error: e instanceof Error ? e.message : String(e) });
    }
    return live.get(id)?.status === "on";
  }

  function disconnect(id) {
    live.get(id)?.client?.close().catch(() => {});
    if (live.has(id)) set(id, null);
  }

  const tools = () =>
    [...live.entries()].flatMap(([id, s]) =>
      (s.tools ?? []).map((t) => ({
        name: `${id}_${t.name}`,
        description: t.description ?? "",
        parameters: t.inputSchema,
        // tools that don't say they only read ask the user first
        readOnly: t.annotations?.readOnlyHint === true,
      })),
    );

  async function call(name, args) {
    const sep = name.indexOf("_");
    const client = live.get(name.slice(0, sep))?.client;
    if (!client) return `Error: ${name} isn't available. Its connector is disconnected.`;
    try {
      return textOf(await client.callTool({ name: name.slice(sep + 1), arguments: args }));
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return { list, connect, disconnect, tools, call };
}
