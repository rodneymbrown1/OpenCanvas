// server/routes/skills.mjs — Skills management API
// Translates: src/app/api/skills/route.ts

import { SkillsManager } from "../../src/lib/core/SkillsManager.js";
import { SHARED_DATA_DIR } from "../../src/lib/globalConfig.js";

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function getManager(scope, cwd) {
  if (scope === "global") {
    return new SkillsManager("global", SHARED_DATA_DIR);
  }
  if (scope === "project" && cwd) {
    return new SkillsManager("project", cwd);
  }
  return null;
}

export async function handle(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;

  // ── GET /api/skills ────────────────────────────────────────────────────
  if (pathname === "/api/skills" && method === "GET") {
    const scope = url.searchParams.get("scope") || "project";
    const cwd = url.searchParams.get("cwd") || undefined;
    const type = url.searchParams.get("type");

    // Special: project doc
    if (type === "project-doc") {
      if (!cwd) {
        jsonResponse(res, { error: "cwd required" }, 400);
        return true;
      }
      const manager = new SkillsManager("project", cwd);
      jsonResponse(res, {
        exists: manager.projectDocExists(),
        content: manager.readProjectDoc(),
        path: manager.projectDocPath,
      });
      return true;
    }

    // Special: global data
    if (type === "global-data") {
      const manager = new SkillsManager("global", SHARED_DATA_DIR);
      jsonResponse(res, {
        exists: manager.globalDataExists(),
        content: manager.readGlobalData(),
        path: manager.globalDataPath,
      });
      return true;
    }

    // Default: skills.md
    const manager = getManager(scope, cwd);
    if (!manager) {
      jsonResponse(
        res,
        { error: "Invalid scope or missing cwd for project scope" },
        400
      );
      return true;
    }

    jsonResponse(res, {
      exists: manager.skillsExist(),
      content: manager.readSkills(),
      path: manager.skillsPath,
      scope,
    });
    return true;
  }

  // ── POST /api/skills ───────────────────────────────────────────────────
  if (pathname === "/api/skills" && method === "POST") {
    const body = await parseBody(req);
    const scope = body.scope || "project";
    const cwd = body.cwd;
    const type = body.type;
    const action = body.action;

    // Write project doc
    if (type === "project-doc") {
      if (!cwd) {
        jsonResponse(res, { error: "cwd required" }, 400);
        return true;
      }
      const manager = new SkillsManager("project", cwd);
      manager.writeProjectDoc(body.content || "");
      jsonResponse(res, { success: true, path: manager.projectDocPath });
      return true;
    }

    // Write global data
    if (type === "global-data") {
      const manager = new SkillsManager("global", SHARED_DATA_DIR);
      manager.writeGlobalData(body.content || "");
      jsonResponse(res, { success: true, path: manager.globalDataPath });
      return true;
    }

    // Ensure skeleton files
    if (action === "ensure") {
      const manager = getManager(scope, cwd);
      if (!manager) {
        jsonResponse(
          res,
          { error: "Invalid scope or missing cwd" },
          400
        );
        return true;
      }
      manager.ensureFiles();
      jsonResponse(res, { success: true });
      return true;
    }

    // Generate "Running the App" section from a RunConfig
    if (action === "generate-run") {
      if (!cwd) {
        jsonResponse(res, { error: "cwd required" }, 400);
        return true;
      }
      const runConfig = body.runConfig;
      if (!runConfig || !runConfig.services) {
        jsonResponse(res, { error: "runConfig required" }, 400);
        return true;
      }
      const manager = new SkillsManager("project", cwd);
      manager.ensureFiles();
      const runSection = SkillsManager.generateRunSection(runConfig);
      manager.appendSection("Running the App", runSection);
      jsonResponse(res, { success: true, path: manager.skillsPath });
      return true;
    }

    // Append section
    if (action === "append") {
      const manager = getManager(scope, cwd);
      if (!manager) {
        jsonResponse(
          res,
          { error: "Invalid scope or missing cwd" },
          400
        );
        return true;
      }
      if (!body.heading || !body.content) {
        jsonResponse(
          res,
          { error: "heading and content required for append" },
          400
        );
        return true;
      }
      manager.appendSection(body.heading, body.content);
      jsonResponse(res, { success: true, path: manager.skillsPath });
      return true;
    }

    // Default: write skills.md
    const manager = getManager(scope, cwd);
    if (!manager) {
      jsonResponse(
        res,
        { error: "Invalid scope or missing cwd" },
        400
      );
      return true;
    }
    manager.writeSkills(body.content || "");
    jsonResponse(res, { success: true, path: manager.skillsPath });
    return true;
  }

  return false;
}
