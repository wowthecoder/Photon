import { randomBytes } from "node:crypto";
import http from "node:http";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// client: the OAuth app Photon signs in with. GitHub has no dynamic client registration, so it needs one;
// a connector whose server supports registration can leave it out and Photon registers itself.
export const CONNECTORS = [
  {
    id: "github",
    name: "GitHub",
    description: "Repositories, issues and pull requests",
    url: "https://api.githubcopilot.com/mcp/",
    scope: "repo read:org read:user",
    needsClient: true,
  },
];

const SIGN_IN_TIMEOUT = 5 * 60_000;
const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>Photon</title><body style="font:15px -apple-system,sans-serif;text-align:center;padding-top:20vh">`;

const textOf = (result) =>
  (result.isError ? "Error: " : "") +
  (result.content ?? []).map((c) => (c.type === "text" ? c.text : c.type === "resource" ? (c.resource.text ?? `[${c.resource.uri}]`) : `[${c.type}]`)).join("\n");

const message = (e) => (e instanceof Error ? e.message : String(e));

// Waits for the browser to come back to http://127.0.0.1:<port>/callback after the user approves.
// RFC 8252 loopback redirect: GitHub accepts any port for a 127.0.0.1 callback URL.
async function loopback(state) {
  let resolve, reject;
  const code = new Promise((res, rej) => ((resolve = res), (reject = rej)));
  code.catch(() => {});
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname !== "/callback") return res.writeHead(404).end();
    const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");
    const ok = !error && url.searchParams.get("state") === state && url.searchParams.get("code");
    res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`${DONE_PAGE}${ok ? "<h2>Connected to Photon</h2><p>You can close this tab.</p>" : `<h2>Photon couldn't connect</h2><p>${error ? "You didn't allow access." : "The sign-in link expired."}</p>`}`);
    ok ? resolve(url.searchParams.get("code")) : reject(new Error(error ?? "Sign-in failed. Try again."));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const timer = setTimeout(() => reject(new Error("Sign-in timed out.")), SIGN_IN_TIMEOUT);
  const close = (reason) => (clearTimeout(timer), server.listening && server.close(), reason && reject(reason));
  return { redirectUrl: `http://127.0.0.1:${server.address().port}/callback`, code, close };
}

// One MCP client per connected connector, signed in with OAuth.
// The model sees each tool as <connector id>_<tool name>.
// store.get(id) / store.set(id, data | null) keep { tokens, client } between launches.
// clients[id] is a pre-registered OAuth app { client_id, client_secret } for connectors that need one.
// openUrl(url) opens the system browser; onSignedIn(id) brings Photon back to the front.
export function createMcp({ onChange, store, clients = {}, openUrl, onSignedIn = () => {}, connectors = CONNECTORS }) {
  const live = new Map(); // id -> { status, error?, client?, tools?, cancel? }

  const list = () =>
    connectors.map(({ id, name, description, needsClient }) => {
      const s = live.get(id);
      return { id, name, description, status: s?.status ?? "off", error: s?.error, toolCount: s?.tools?.length ?? 0, setUp: !needsClient || !!clients[id] };
    });
  const set = (id, s) => (s ? live.set(id, s) : live.delete(id), onChange(list()));
  const fail = (id, e) => set(id, { status: "error", error: message(e) });

  // The SDK's OAuth hooks. Only an explicit sign-in may open the browser; later 401s ask the user to reconnect.
  // Without a redirectUrl the SDK assumes a machine-to-machine client, so background connections get a placeholder.
  function provider(def, { redirectUrl = "http://127.0.0.1/callback", state, interactive }) {
    let verifier;
    const saved = () => store.get(def.id) ?? {};
    return {
      redirectUrl,
      clientMetadata: { client_name: "Photon", redirect_uris: [redirectUrl], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: clients[def.id] ? "client_secret_post" : "none", scope: def.scope },
      clientInformation: () => (clients[def.id] ? { ...clients[def.id], token_endpoint_auth_method: "client_secret_post" } : saved().client),
      saveClientInformation: (client) => store.set(def.id, { ...saved(), client }),
      tokens: () => saved().tokens,
      saveTokens: (tokens) => store.set(def.id, { ...saved(), tokens }),
      state: () => state,
      saveCodeVerifier: (v) => (verifier = v),
      codeVerifier: () => verifier,
      redirectToAuthorization: (url) => {
        if (!interactive) throw new Error(`Photon was signed out of ${def.name}. Connect again.`);
        openUrl(url.href);
      },
      invalidateCredentials: (scope) => {
        if (scope === "all" || scope === "tokens") store.set(def.id, { ...saved(), tokens: undefined });
      },
    };
  }

  // Connects with the saved tokens and lists the tools.
  async function open(def) {
    const client = new Client({ name: "Photon", version: "0.1.0" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(def.url), { authProvider: provider(def, { interactive: false }) }));
      const tools = [];
      let cursor;
      do {
        const page = await client.listTools(cursor ? { cursor } : {});
        tools.push(...page.tools);
        cursor = page.nextCursor;
      } while (cursor);
      if (live.get(def.id)?.status !== "connecting") return client.close(); // cancelled meanwhile
      set(def.id, { status: "on", client, tools });
    } catch (e) {
      client.close().catch(() => {});
      if (live.get(def.id)?.status === "connecting") fail(def.id, e);
    }
  }

  const find = (id) => {
    const def = connectors.find((c) => c.id === id);
    if (!def) throw new Error(`Unknown connector ${id}`);
    return def;
  };

  // Reconnects with saved tokens, e.g. at launch.
  async function resume(id) {
    if (!store.get(id)?.tokens) return;
    set(id, { status: "connecting" });
    await open(find(id));
  }

  // Opens the browser to sign in, waits for the user to approve, then connects.
  async function connect(id) {
    const def = find(id);
    if (def.needsClient && !clients[id]) return fail(id, `${def.name} needs an OAuth app. See "Connectors" in the README.`);
    disconnect(id);
    const state = randomBytes(16).toString("hex");
    const { redirectUrl, code, close } = await loopback(state);
    set(id, { status: "connecting", cancel: () => close(new Error("Cancelled")) });
    try {
      const p = provider(def, { redirectUrl, state, interactive: true });
      const opts = { serverUrl: def.url, scope: def.scope };
      if ((await auth(p, opts)) === "REDIRECT") await auth(p, { ...opts, authorizationCode: await code });
      onSignedIn(id);
      await open(def);
    } catch (e) {
      if (live.get(id)?.status === "connecting") fail(id, e);
    } finally {
      close();
    }
  }

  // Signs out: forgets the tokens. The app stays authorized on GitHub until the user revokes it there.
  function disconnect(id) {
    const s = live.get(id);
    s?.cancel?.();
    s?.client?.close().catch(() => {});
    if (live.has(id)) set(id, null);
    store.set(id, null);
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
      return `Error: ${message(e)}`;
    }
  }

  return { list, connect, resume, disconnect, tools, call };
}
