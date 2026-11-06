# Photon

A ChatGPT-style desktop chat app for macOS that runs language models entirely on your Mac. It's built with Electron, React, Vite and TypeScript, and uses llama.cpp's `llama-server` to run the models.

You browse GGUF models on Hugging Face, download them inside the app, and chat with them. No data leaves your machine except the model downloads and the Hugging Face catalog searches.

## Requirements

- A Mac with Apple Silicon (M1 or later). The bundled llama.cpp build is arm64 only.
- Node.js 20 or newer (`node -v`)

## Setup

```bash
npm install
```

If Electron fails with "Electron failed to install correctly", npm skipped its download script. That happens when `ignore-scripts=true` is in your `~/.npmrc`. Fetch the binary manually:

```bash
npx install-electron
```

The first `npm run dev` also downloads a pinned llama.cpp build (about 17 MB) into `resources/llama/`. To fetch it on its own:

```bash
node scripts/fetch-llama.js
```

## Run

| Command | What it does |
| --- | --- |
| `npm run dev` | Opens the app in an Electron window with hot reload. Use this for day-to-day work. |
| `npm start` | Builds the UI and runs it in Electron without the dev server. |
| `npm run dist` | Packages `release/Photon-<version>-arm64.dmg`, with llama.cpp bundled. |
| `npm run web` | Runs only the UI at http://localhost:1420 in a browser. The model engine isn't available there. |
| `npm test` | Runs the catalog checks (quantization names, grouping, default quant). |

Hot reload covers everything in `src/`. If you change anything in `electron/`, stop `npm run dev` and start it again.

The `.dmg` isn't code-signed. The first time you open it, macOS will block it: right-click the app and choose **Open**.

## Using it

1. Open **Models** in the sidebar, then **Discover**.
2. Pick a model family (Qwen, Gemma, GPT-OSS, …) or search. Each row is one model, with its size, context length, estimated download size and total downloads.
3. Click a model to see where you can download it from: the official publisher and the trusted quantizers (ggml-org, unsloth, bartowski, lmstudio-community). Each source has a quantization picker with exact file sizes, defaulting to a 4-bit file.
4. Click **Download**. Progress appears there and in the **Downloaded** tab, where you can pause, resume or delete.
5. Start a new chat (⌘N) and pick the model in the header. It loads into memory on the first message.

Models are stored in `~/Library/Application Support/Photon/models` by default. To use a different folder, go to **Settings → Models folder → Change…**. Changing the folder doesn't move models you've already downloaded.

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
Electron main: starts and stops llama-server, owns the models folder and config
```

- **Startup.** On launch, `electron/engine.js` starts `llama-server` with no model, which puts it in "router mode", and points it at the models folder with the `LLAMA_CACHE` environment variable. Each launch gets a free port and a fresh API key, so other apps and websites can't use the server.
- **Memory.** `--models-max 1` keeps one model in memory at a time. `--sleep-idle-seconds 600` frees that memory after 10 minutes without use.
- **Logs.** The server's output goes to `~/Library/Application Support/Photon/llama-server.log`.
- **Upgrading llama.cpp.** Change `BUILD` in `scripts/fetch-llama.js` to a newer release from https://github.com/ggml-org/llama.cpp/releases.

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
electron/engine.js    Starts, health-checks and stops llama-server
electron/preload.cjs  Exposes window.photon (engine state, folder actions) to the UI
scripts/dev.js        Starts Vite, then Electron pointed at it
scripts/fetch-llama.js  Downloads the pinned llama.cpp build into resources/llama
src/App.tsx           App state: chats, views, streaming, shortcuts
src/useEngine.ts      Engine state, downloaded models, live download progress
src/llm.ts            llama-server client: models, downloads, streaming chat
src/catalog.ts        Model families, Hugging Face search grouped by base model, quantization sizes
src/Models.tsx        Models screen: Downloaded and Discover tabs
src/Chat.tsx          Model picker, messages (markdown, thinking), composer
src/Sidebar.tsx       Models link, chat list, settings
src/Settings.tsx      Default model, models folder, system prompt, temperature, theme
src/store.ts          Types and a hook that saves state to localStorage
src/styles.css        Light/dark theme and all styling
resources/            App icon, and llama.cpp once fetched (not committed)
```

Chats are saved in `localStorage`. Move them to SQLite in the main process once your chat history gets large.
