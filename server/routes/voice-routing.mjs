/**
 * Voice Routing API
 *
 * GET /api/voice-routing?view=<tabId>&cwd=<projectRoot>
 *   → Returns { cwd, skillContent, tabId } for context-aware voice recording.
 *
 * Resolves the working directory and skill instructions based on the
 * active tab when the user triggers a voice recording.
 */

import path from "node:path";
import { ensureRecordingSkills, readRecordingSkill } from "../recording-skills.mjs";

const HOME = process.env.HOME || process.env.USERPROFILE || "/tmp";
const OC_HOME = path.join(HOME, ".open-canvas");

/**
 * Resolve the working directory for a given tab.
 * Some tabs have fixed directories, others use the project root.
 */
function resolveCwd(tabId, projectRoot) {
  switch (tabId) {
    case "calendar":
      return path.join(OC_HOME, "calendar");
    case "data":
      return path.join(OC_HOME, "shared-data");
    case "settings":
      return OC_HOME;
    default:
      // workspace, ports, projects, jobs, usage, appify
      return projectRoot || process.cwd();
  }
}

export function handle(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;

  if (pathname !== "/api/voice-routing") return false;

  if (method === "GET") {
    const view = url.searchParams.get("view") || "workspace";
    const projectRoot = url.searchParams.get("cwd") || "";

    // Lazy bootstrap — creates ~/.open-canvas/recording/ and default .md files
    ensureRecordingSkills();

    const cwd = resolveCwd(view, projectRoot);
    const skillContent = readRecordingSkill(view);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        tabId: view,
        cwd,
        skillContent,
      })
    );
    return true;
  }

  return false;
}
