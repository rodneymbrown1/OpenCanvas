// server/routes/agents.mjs — Agent detection API
// Translates: src/app/api/agents/route.ts

import { exec } from "child_process";

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// Cache agent detection — installations don't change during a session
let cachedAgents = null;
let cacheTime = 0;
const CACHE_TTL = 60_000; // 60 seconds

function detectAgentAsync(cmd) {
  return new Promise((resolve) => {
    exec(`which ${cmd} 2>/dev/null`, { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve({ installed: false, path: null });
      } else {
        resolve({ installed: true, path: stdout.trim() });
      }
    });
  });
}

export async function handle(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;

  // ── GET /api/agents ────────────────────────────────────────────────────
  if (pathname === "/api/agents" && method === "GET") {
    if (cachedAgents && Date.now() - cacheTime < CACHE_TTL) {
      jsonResponse(res, { agents: cachedAgents });
      return true;
    }

    const [claude, codex, gemini] = await Promise.all([
      detectAgentAsync("claude"),
      detectAgentAsync("codex"),
      detectAgentAsync("gemini"),
    ]);

    cachedAgents = [
      { id: "claude", label: "Claude Code", ...claude },
      { id: "codex", label: "Codex", ...codex },
      { id: "gemini", label: "Gemini", ...gemini },
    ];
    cacheTime = Date.now();

    jsonResponse(res, { agents: cachedAgents });
    return true;
  }

  return false;
}
