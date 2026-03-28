/**
 * Voice Context API
 *
 * GET /api/voice-context
 *   → Returns { cwd, skillContent } with the full composed skill context.
 *
 * The agent always spawns in ~/.open-canvas/recording/ with ALL skills
 * composed into a single context string. No tab-based routing — the agent
 * determines intent natively from the user's message.
 */
import { log } from "../logger.mjs";

import { composeVoiceContext, RECORDING_DIR } from "../recording-skills.mjs";

export function handle(req, res, url) {
  const pathname = url.pathname;

  // New unified endpoint
  if (pathname === "/api/voice-context" && req.method === "GET") {
    log("voice", ` GET /api/voice-context — composing all skills, cwd=${RECORDING_DIR}`);
    const skillContent = composeVoiceContext();
    log("voice", ` GET /api/voice-context — returning ${skillContent.length} bytes of skill content`);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        cwd: RECORDING_DIR,
        skillContent,
      })
    );
    return true;
  }

  // Legacy endpoint — redirect to new behavior (same response, ignore tab)
  if (pathname === "/api/voice-routing" && req.method === "GET") {
    const view = url.searchParams.get("view") || "(none)";
    log("voice", ` GET /api/voice-routing (LEGACY) — view=${view} — redirecting to new unified behavior`);
    const skillContent = composeVoiceContext();
    log("voice", ` GET /api/voice-routing (LEGACY) — returning ${skillContent.length} bytes, cwd=${RECORDING_DIR}`);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        cwd: RECORDING_DIR,
        skillContent,
        tabId: "voice", // Legacy compat field
      })
    );
    return true;
  }

  return false;
}
