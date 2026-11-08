# Photon

A ChatGPT-style desktop chat app for macOS that runs language models entirely on your Mac. It's built with Electron, React, Vite and TypeScript, and uses llama.cpp's `llama-server` to run the models.

You browse GGUF models on Hugging Face, download them inside the app, and chat with them. It also generates images locally, using stable-diffusion.cpp's `sd-server`. No data leaves your machine except the model downloads and the Hugging Face catalog searches.

## Requirements

- A Mac with Apple Silicon (M1 or later). The bundled llama.cpp build is arm64 only.
- Node.js 20 or newer (`node -v`)
- git, cmake and the Xcode Command Line Tools, to build `sd-server` (`brew install cmake`, `xcode-select --install`)

## Setup

```bash
npm install
```

If Electron fails with "Electron failed to install correctly", npm skipped its download script. That happens when `ignore-scripts=true` is in your `~/.npmrc`. Fetch the binary manually:

```bash
npx install-electron
```

The first `npm run dev` also downloads a pinned llama.cpp build (about 17 MB) into `resources/llama/`, and builds a pinned stable-diffusion.cpp `sd-server` into `resources/sd/` (a minute or two). To do either on its own:

```bash
node scripts/fetch-llama.js
```

```bash
node scripts/fetch-sd.js
```

`sd-server` is built from source rather than downloaded because upstream has no API key option yet. `scripts/sd-server-api-key.patch` adds one, so other apps and websites can't use the server.

## Run

| Command | What it does |
| --- | --- |
| `npm run dev` | Opens the app in an Electron window with hot reload. Use this for day-to-day work. |
| `npm start` | Builds the UI and runs it in Electron without the dev server. |
| `npm run dist` | Packages `release/Photon-<version>-arm64.dmg`, with llama.cpp and sd-server bundled. |
| `npm run web` | Runs only the UI at http://localhost:1420 in a browser. The model engine isn't available there. |
| `npm test` | Runs the catalog checks (quantization names, grouping, default quant) the image catalog checks (grouping by base model) the downloader checks (resume, size mismatch) and the connector checks (against a stub MCP server). |

Hot reload covers everything in `src/`. If you change anything in `electron/`, stop `npm run dev` and start it again.

The `.dmg` isn't code-signed. The first time you open it, macOS will block it: right-click the app and choose **Open**.

## Using it

1. Open **Models** in the sidebar, then **Text → Discover**.
2. Pick a model family (Qwen, Gemma, GPT-OSS, …) or search. Each row is one model, with its size, context length, estimated download size and total downloads.
3. Click a model to see where you can download it from: the official publisher and the trusted quantizers (ggml-org, unsloth, bartowski, lmstudio-community). Each source has a quantization picker with exact file sizes, defaulting to a 4-bit file.
4. Click **Download**. Progress appears there and in **Text → Downloaded**, where you can pause, resume or delete.
5. Start a new chat (⌘N) and pick the model in the header. It loads into memory on the first message.
6. Models marked **Vision** or **Audio** can read attachments. With one selected, click the paperclip in the message box, paste an image, or drop a file on it. Images are sent as PNG; audio can be MP3, WAV or FLAC. Attachments are saved in `~/Library/Application Support/Photon/attachments` and deleted with their chat.

To let a model use your GitHub account:

1. Open **Connectors** in the sidebar and click **Connect** next to **GitHub**.
2. Your browser opens GitHub's authorization page. Approve Photon and you're sent back to the app.
3. Chat with a model that supports tool calling (Qwen3, gpt-oss, Llama 3.2 and others). Tools that only read run straight away; Photon asks before running anything else. After 8 rounds of tool calls the model has to answer without them.

Photon talks to GitHub's MCP server (`api.githubcopilot.com/mcp`) from the main process. The sign-in is kept in `config.json`, encrypted with the macOS keychain. **Disconnect** forgets it; to revoke Photon's access completely, also remove it under GitHub → Settings → Applications → Authorized OAuth Apps.

To generate images:

1. Open **Models → Image → Discover**. Like text models, pick a family or search Hugging Face, open a model to see its sources, choose a quantization and click **Download**. Photon also downloads the text encoder and VAE that model needs; files shared between models are downloaded once.
2. Open **Images** in the sidebar, describe the image, pick a size and click **Generate**. A preview updates on every step. On an M5 Pro, Z-Image Turbo takes about 75 s at 1024×1024 and FLUX.2 klein 4B about 15 s at 768×768.
3. To edit an image, pick a model that can edit (Qwen-Image-Edit, FLUX.1 Kontext, FLUX.2 or FLUX.3 klein, Qwen-Image 2.1), then add an input image, drop one on the prompt box, or click **Edit this image** on a picture in your gallery. Describe the change and click **Edit**. Qwen-Image-Edit needs an input image; the others can also start from scratch.
4. Click an image to see its prompt and seed, reuse them, edit it, show it in Finder or delete it.

Models are stored in `~/Library/Application Support/Photon/models` by default. To use a different folder, go to **Settings → Models folder → Change…**. Changing the folder doesn't move models you've already downloaded.

## Connectors setup

GitHub doesn't let apps register themselves for OAuth, so Photon signs in with an OAuth app you register once:

1. Go to https://github.com/settings/applications/new.
2. Set **Homepage URL** to anything (e.g. your repo) and **Authorization callback URL** to `http://127.0.0.1/callback`. GitHub accepts any port for a `127.0.0.1` callback, so Photon can pick a free one each time.
3. Create the app, then click **Generate a new client secret**.
4. Copy `electron/oauth-clients.example.json` to `electron/oauth-clients.json` and fill in the client ID and secret. The file is git-ignored but packaged into the app, like `gh` and other desktop apps do: a desktop app can't keep a client secret secret, and PKCE protects the sign-in instead.
5. Restart `npm run dev`.

### Adding a connector

A connector is a remote MCP server that signs in with OAuth. To add one:

1. Add an entry to `electron/connectors.json`:
   ```json
   {
     "id": "gmail",
     "name": "Gmail",
     "description": "Search, read and draft email",
     "url": "https://gmailmcp.googleapis.com/mcp/v1",
     "scope": "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose",
     "oauthApp": "google"
   }
   ```
   - `id` names its tools for the model (`gmail_<tool>`), so use letters only; no underscores.
   - `scope` is what Photon asks for at sign-in. Leave it out and Photon asks for everything the server lists.
   - `oauthApp` is the key of its OAuth app in `electron/oauth-clients.json`. Several connectors can share one, e.g. Gmail and Google Drive both use `google`. Leave it out if the server supports dynamic client registration (Notion, Linear and others), and Photon registers itself.
2. Add its logo as `src/connector-icons/<id>.svg`. Without one, the card shows the first letter of its name.
3. If it has an `oauthApp`, register that app with the provider with `http://127.0.0.1/callback` as the redirect URL and add its client ID and secret to `electron/oauth-clients.json`. For Google, create an OAuth client of type **Desktop app** in Google Cloud Console.

## How it works

```
React UI ──fetch──▶ Hugging Face API            catalog: search, file sizes
    │
    └──fetch──▶ llama-server (router mode, 127.0.0.1, random port + API key)
                  GET    /models                downloaded models and their status
                  POST   /models                start a download
                  GET    /models/sse            live download and loading events
                  POST   /models/unload         pause a download
                  DELETE /models?model=…        delete a model
                  POST   /v1/chat/completions   chat (streamed; loads the model on demand)
    └──fetch──▶ sd-server (127.0.0.1, random port + API key)
                  GET    /sdcpp/v1/model-files       image model files on disk
                  POST   /sdcpp/v1/models/load       load a recipe with its files
                  POST   /sdcpp/v1/img_gen           start a generation job
                  GET    /sdcpp/v1/jobs/{id}         job status, live preview, result
Electron main: starts and stops both servers, owns the models folder and config,
               downloads image models, saves generated images
```

- **Startup.** On launch, `electron/engine.js` starts `llama-server` with no model, which puts it in "router mode", and points it at the models folder with the `LLAMA_CACHE` environment variable. Each launch gets a free port and a fresh API key, so other apps and websites can't use the server.
- **Memory.** `--models-max 1` keeps one model in memory at a time. `--sleep-idle-seconds 600` frees that memory after 10 minutes without use. Generating an image unloads the chat model, and sending a chat message unloads the image model.
- **Image models.** sd-server can't download models, so the main process does: files go to `<models folder>/diffusion/{diffusion_models,text_encoders,vae}` and resume from `.part` files. Only base models listed in `electron/imageFamilies.json` can run: each entry names its sd-server recipe and the text encoder and VAE to download with it. To support another model, add its base model there with a recipe from stable-diffusion.cpp's `examples/server/recipes`, and set `edit` to `required` or `optional` if the recipe takes reference images. Your downloaded image models are listed in `<models folder>/diffusion/models.json`. Generated images are saved as PNGs in `~/Library/Application Support/Photon/images`.
- **Logs.** The servers' output goes to `llama-server.log` and `sd-server.log` in `~/Library/Application Support/Photon/`.
- **Upgrading llama.cpp.** Change `BUILD` in `scripts/fetch-llama.js` to a newer release from https://github.com/ggml-org/llama.cpp/releases.
- **Upgrading stable-diffusion.cpp.** Change `TAG` in `scripts/fetch-sd.js` to a newer release from https://github.com/leejet/stable-diffusion.cpp/releases. If the patch no longer applies, update it against `examples/server/main.cpp`.

## Shortcuts

| Keys | Action |
| --- | --- |
| ⌘N | New chat |
| ⌘B | Show or hide the sidebar |
| ⌘, | Settings |
| Enter / Shift+Enter | Send / new line |

## Project layout

```
electron/main.js      Window, config.json, IPC handlers (folder picker, disk info)
electron/engine.js    Starts, health-checks and stops a local server (llama-server, sd-server)
electron/imageModels.js  Image model download status, download/pause/delete
electron/imageFamilies.json  Supported image base models: recipe, text encoder and VAE
electron/download.js  Resumable file download (tested by download.test.js)
electron/preload.cjs  Exposes window.photon (engine state, folder actions) to the UI
scripts/dev.js        Starts Vite, then Electron pointed at it
scripts/fetch-llama.js  Downloads the pinned llama.cpp build into resources/llama
scripts/fetch-sd.js   Builds the pinned, patched sd-server into resources/sd
src/App.tsx           App state: chats, views, streaming, shortcuts
src/useEngine.ts      Engine state, downloaded models, live download progress
src/llm.ts            llama-server client: models, downloads, streaming chat
src/diffusion.ts      sd-server client: load an image model, run and poll a generation
src/imageCatalog.ts   Hugging Face search for image GGUFs, grouped by supported base model
src/Images.tsx        Images screen: prompt, live preview, gallery, image viewer
src/catalog.ts        Model families, Hugging Face search grouped by base model, quantization sizes
src/Models.tsx        Models screen: Text and Image sections, each with Downloaded and Discover tabs
src/Chat.tsx          Model picker, messages (markdown, thinking), composer
src/Sidebar.tsx       Models link, chat list, settings
src/Settings.tsx      Default model, models folder, system prompt, temperature, theme
src/store.ts          Types and a hook that saves state to localStorage
src/styles.css        Light/dark theme and all styling
resources/            App icon, and llama.cpp and sd-server once fetched (not committed)
```

Chats are saved in `localStorage`. Move them to SQLite in the main process once your chat history gets large.
