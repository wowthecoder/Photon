# Photon

A ChatGPT-style desktop chat app for macOS that will run language models locally. It's built with Electron, React, Vite and TypeScript.

The backend is still a mock: `src/llm.ts` sends back fake replies that stream in, so you can build the UI before any model is wired up.

## Requirements

- macOS
- Node.js 20 or newer (`node -v`)

## Setup

```bash
npm install
```

If Electron fails with "Electron failed to install correctly", npm skipped its download script. That happens when `ignore-scripts=true` is in your `~/.npmrc`. Fetch the binary manually:

```bash
npx install-electron
```

## Run

| Command | What it does |
| --- | --- |
| `npm run dev` | Opens the app in an Electron window with hot reload. Use this for day-to-day work. |
| `npm run web` | Runs only the UI at http://localhost:1420 in your browser. There are no native window features. |
| `npm start` | Builds the UI and runs it in Electron without the dev server. |
| `npm run dist` | Packages `release/Photon-<version>.dmg`. |

Hot reload covers everything in `src/`. If you change `electron/main.js`, stop `npm run dev` and start it again.

The `.dmg` isn't code-signed. The first time you open it, macOS will block it: right-click the app and choose **Open**.

## Shortcuts

| Keys | Action |
| --- | --- |
| ⌘N | New chat |
| ⌘B | Show or hide the sidebar |
| ⌘, | Settings |
| Enter / Shift+Enter | Send / new line |

## Project layout

```
electron/main.js   Electron main process: window, traffic lights, external links
scripts/dev.js     Starts the Vite dev server, then Electron pointed at it
src/App.tsx        App state: chats, active chat, streaming, shortcuts
src/Sidebar.tsx    Chat list, new chat, delete, settings button
src/Chat.tsx       Header with model picker, messages (markdown), composer
src/Settings.tsx   Settings dialog: default model, system prompt, temperature, theme
src/llm.ts         Model list and streaming chat (mock, replace with the real backend)
src/store.ts       Types and a hook that saves state to localStorage
src/styles.css     Light/dark theme and all styling
resources/         App icon
```

## Wiring a real backend

Only `src/llm.ts` needs to change. `streamChat` is an async generator that yields text tokens. Two common ways to fill it in:

- **Local HTTP server** (llama.cpp's `llama-server`, Ollama, or your own C++ server). Call it with `fetch` and read the streamed response. You can start the server from `electron/main.js` with `child_process.spawn` and ship it inside the app using electron-builder's `extraResources` setting.
- **Electron IPC**. Run the model from the main process and send tokens to the UI through a preload script.

Chats are saved in `localStorage`. Move them to the backend, for example SQLite, once your chat history gets large.
