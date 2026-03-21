<p align="center">
  <img src="assets/open_canvas_logo.png" alt="Open Canvas" width="400" />
</p>

<p align="center"><strong>Build apps from your data using the coding agents you already have set up.</strong></p>

Open Canvas is a local browser-based IDE that connects to your existing Claude Code, Codex, and Gemini accounts — no new API keys required. It wraps your terminal coding agents in a clean UI so you can focus on building instead of managing terminal sessions.

If you already use Claude Code, Codex, or Gemini CLI, Open Canvas gives you a better workflow: bring in your data, point your agent at it, and build quick apps that help you day to day — all from one place.

---

## Why Open Canvas?

Solo devs using AI coding agents spend time switching between terminals, previewing apps, managing files, and checking usage. Open Canvas puts all of that in one view:

- **Use your existing accounts** — Open Canvas connects to the coding agents already authenticated on your machine. No new signups, no API keys to configure (unless you want to).
- **Switch between agents instantly** — Toggle between Claude, Codex, and Gemini with one click. Try different agents on the same project without juggling terminal windows.
- **See what your agents are doing** — Jobs dashboard shows active tasks. Usage view shows token spend across all agents in one place.
- **Data-first workflow** — Drop your files (spreadsheets, PDFs, docs, images), let the agent format them to markdown, then build apps straight from that data.
- **No SaaS needed** — Everything runs on your machine. The entire premise is that you don't need a cloud service to build useful tools — you can do it locally with the resources you already have.

---

## Features

### Real Agent Terminals
Full PTY terminal sessions in the browser via xterm.js. This is the same Claude Code / Codex / Gemini experience you get in your terminal — not a simulation.

### Agent Switching
One-click switching between Claude, Codex, and Gemini. The active agent is saved to your project config so it persists across sessions.

### App Preview
The main workspace view is your app. As your agent builds, the preview updates live. File explorer and terminal are collapsible so you can go full-screen on just the app.

### VS Code-Style File Explorer
Browse your project files in a familiar tree view, synced to your OS filesystem. Right-click any file to view it in a popup without leaving your workspace.

### Jobs Dashboard
See what your coding agent is actively working on, track task history, and monitor status.

### Usage Metrics
View token usage and cost estimates across all three agent providers in a single dashboard.

### Settings & Configuration
- **Agent Settings** — Choose your active agent, set CLI or API mode, configure permissions (read, write, execute, web access)
- **API Keys** — Optional key management for API mode
- **MCP Servers** — Connect to external services (Telegram, Notion, Slack, etc.) via Model Context Protocol
- **Project YAML** — Visual editor for your project config, or edit the YAML directly

### CLI
```bash
oc init my-project   # Scaffold a new workspace
oc start             # Launch Open Canvas in your browser
oc format            # Convert docs to markdown (coming soon)
```

---

## Getting Started

### Prerequisites
- Node.js 18+
- At least one coding agent CLI installed and authenticated:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — `npm install -g @anthropic-ai/claude-code`
  - [Codex](https://github.com/openai/codex) — `npm install -g @openai/codex`
  - Gemini CLI — `npm install -g @anthropic-ai/gemini`

### Install & Run

```bash
git clone https://github.com/rodneymbrown1/OpenCanvas.git
cd OpenCanvas
npm install
npm run open-canvas
```

This starts both the Next.js app and the PTY server, then open [http://localhost:3000](http://localhost:3000).

### First Use

1. Open Canvas loads into the workspace view
2. Click **Select Folder** in the top bar to set your working directory
3. Click **disconnected** in the terminal panel to connect your agent
4. Open Canvas auto-detects which agents are installed on your system
5. Click **Connect** — your agent terminal appears, ready to go
6. Start building. The app preview updates as your agent works.

---

## How It Works

Open Canvas is a Next.js app that runs locally. It spawns real PTY sessions for your coding agents using [node-pty](https://github.com/nickolasburr/node-pty) and streams them to the browser via WebSocket + xterm.js.

```
┌─────────────────────────────────────────────────┐
│  Browser (localhost:3000)                        │
│  ┌───────────┬─────────────────────────────────┐ │
│  │  File     │  App Preview (iframe)           │ │
│  │  Explorer │                                 │ │
│  │           ├─────────────────────────────────┤ │
│  │           │  Agent Terminal (xterm.js)      │ │
│  └───────────┴─────────────────────────────────┘ │
└──────────────────────┬──────────────────────────┘
                       │ WebSocket
              ┌────────┴────────┐
              │  PTY Server     │
              │  (localhost:3001)│
              └────────┬────────┘
                       │ node-pty
              ┌────────┴────────┐
              │  claude / codex │
              │  / gemini CLI   │
              └─────────────────┘
```

Your coding agent runs as a real process on your machine using your authenticated CLI session. Open Canvas doesn't proxy, modify, or intercept your agent's communication — it just gives it a browser-based UI.

---

## Project Structure

```
open-canvas/
├── open-canvas.yaml           # Project config (agents, MCP, preferences)
├── server/pty-server.mjs      # WebSocket PTY bridge
├── cli/bin/oc.mjs             # CLI tool
├── src/
│   ├── app/
│   │   ├── workspace/         # Main IDE view (preview + terminal + explorer)
│   │   ├── jobs/              # Active jobs dashboard
│   │   ├── usage/             # Token usage across agents
│   │   ├── project/           # YAML config editor
│   │   ├── settings/          # Agent config, API keys, MCP servers
│   │   └── api/               # Backend routes
│   ├── components/            # UI components
│   └── lib/                   # Config reader/writer
```

---

## Who Is This For?

Open Canvas is for solo devs and small teams who:

- Already use Claude Code, Codex, or Gemini and want a better workflow
- Want to build quick internal tools from their own data without deploying to the cloud
- Prefer a visual workspace over managing multiple terminal windows
- Want to compare coding agents side by side on the same project
- Need a simple way to monitor usage and costs across AI providers

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js, React, Tailwind CSS |
| Terminal | xterm.js, @homebridge/node-pty-prebuilt-multiarch |
| Real-time | WebSocket (ws) |
| File system | chokidar (fs watcher) |
| Config | YAML (open-canvas.yaml) |
| Icons | Lucide React |

---

## License

ISC
