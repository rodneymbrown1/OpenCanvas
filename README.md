<p align="center">
  <img src="assets/open_canvas_logo.png" alt="Open Canvas" width="400" />
</p>

<p align="center"><strong>Build apps from your data using the coding agents you already have.</strong></p>

<p align="center">
  Cost to run: <strong>$0</strong>. Uses your personal Claude Code, Codex, or Gemini CLI account. Runs locally.
</p>

---

## Get Started

```bash
git clone https://github.com/rodneymbrown1/OpenCanvas.git && cd OpenCanvas
npm install
npm run open-canvas
```

Opens at [localhost:3000](http://localhost:3000). Select a folder, connect your agent, start building.

Requires Node.js 18+ and at least one coding agent CLI installed (`claude`, `codex`, or `gemini`).

---

## What It Does

Open Canvas is a local browser IDE that wraps your terminal coding agents in a workspace with live app preview, file management, and project tracking.

### Switch Between Agents

Toggle between Claude, Codex, and Gemini with one click. Same project, different agent.

<!-- ![Agent Switcher](assets/screenshots/agent-switcher.png) -->

### Live App Preview

Click **Run App** — the agent detects your stack and starts the dev server. Preview loads automatically in the workspace.

<!-- ![App Preview](assets/screenshots/app-preview.png) -->

### Jobs

See active agent sessions, track what's running, view history.

<!-- ![Jobs](assets/screenshots/jobs.png) -->

### Usage & Cost

Token usage and cost estimates per agent, per project. See what you're spending.

<!-- ![Usage](assets/screenshots/usage.png) -->

### Port Manager

See which ports are in use across your projects. Kill processes directly.

<!-- ![Ports](assets/screenshots/ports.png) -->

### Global Shared Data

Upload data once, share it across all your projects. No duplication. The agent reads a `skills.md` in your shared data directory to learn how you want your data organized and formatted.

<!-- ![Data Manager](assets/screenshots/data-manager.png) -->

### File Explorer with Drag & Drop

VS Code-style file tree. Drag files from your desktop into any folder. Move files between directories. Right-click for context menu.

### Settings

- **Coding Agents** — choose active agent, CLI or API mode, permissions (read/write/execute/web)
- **API Keys** — optional, for API mode
- **MCP Servers** — connect external services via Model Context Protocol
- **Project Config** — edit your project YAML directly

<!-- ![Settings](assets/screenshots/settings.png) -->

### Project Manager

Manage multiple projects from one Open Canvas instance. Open projects in new tabs for side-by-side work. Global config at `~/.open-canvas/`.

---

## Coming Soon

- **Open Canvas Launcher** — desktop app to launch Open Canvas without the terminal
- **Multi-terminal tabs** — multiple agent sessions per project
- **App Builder wizard** — guided app scaffolding from your data
- **Document formatting pipeline** — auto-convert PDFs and docs to markdown

---

## License

ISC
