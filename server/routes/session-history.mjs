import fs from "fs";
import path from "path";
import os from "os";

const OC_HOME = path.join(os.homedir(), ".open-canvas");
const HISTORY_DIR = path.join(OC_HOME, "session-history");

function slugify(workDir) {
  if (!workDir) return "_default";
  return workDir.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 80);
}

function historyPath(cwd) {
  return path.join(HISTORY_DIR, `${slugify(cwd)}.json`);
}

function ensureDir() {
  if (!fs.existsSync(HISTORY_DIR)) {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
  }
}

/** Read history entries for a project. Returns [] if no file. */
export function readHistory(cwd) {
  const filePath = historyPath(cwd);
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return [];
  }
}

/** Append a session entry to history (deduplicated by sessionId). Atomic write. */
export function appendHistory(cwd, entry) {
  ensureDir();
  const filePath = historyPath(cwd);
  const entries = readHistory(cwd);

  // Deduplicate — don't record same session twice
  if (entries.some((e) => e.sessionId === entry.sessionId)) return;

  entries.unshift(entry); // newest first

  // Write atomically: tmp file then rename
  const tmpPath = filePath + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(entries, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

export function handle(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;

  if (pathname !== "/api/session-history") return false;

  const cwd = url.searchParams.get("cwd");
  if (!cwd) {
    json(res, { error: "cwd query parameter required" }, 400);
    return true;
  }

  if (method === "GET") {
    const limit = parseInt(url.searchParams.get("limit") || "100", 10);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    const entries = readHistory(cwd);
    const sliced = entries.slice(offset, offset + limit);
    json(res, { entries: sliced, total: entries.length });
    return true;
  }

  if (method === "DELETE") {
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId) {
      json(res, { error: "sessionId query parameter required" }, 400);
      return true;
    }

    ensureDir();
    const filePath = historyPath(cwd);
    const entries = readHistory(cwd).filter((e) => e.sessionId !== sessionId);
    const tmpPath = filePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(entries, null, 2));
    fs.renameSync(tmpPath, filePath);
    json(res, { ok: true, remaining: entries.length });
    return true;
  }

  return false;
}
