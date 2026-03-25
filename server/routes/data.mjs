import fs from "fs";
import path from "path";
import {
  isSetUp,
  getGlobalDataStatus,
  SHARED_DATA_DIR,
  setupGlobalConfig,
  ensureSharedDataDirs,
  linkGlobalToProject,
} from "../../src/lib/globalConfig.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function bufferIndexOf(buf, search, fromIndex) {
  for (let i = fromIndex; i <= buf.length - search.length; i++) {
    let found = true;
    for (let j = 0; j < search.length; j++) {
      if (buf[i + j] !== search[j]) { found = false; break; }
    }
    if (found) return i;
  }
  return -1;
}

function parseMultipart(buf, boundary) {
  const parts = [];
  const boundaryBuf = Buffer.from(`--${boundary}`);
  let start = bufferIndexOf(buf, boundaryBuf, 0);
  if (start === -1) return parts;
  start += boundaryBuf.length + 2;

  while (true) {
    const end = bufferIndexOf(buf, boundaryBuf, start);
    if (end === -1) break;

    const partBuf = buf.slice(start, end - 2);
    const headerEnd = bufferIndexOf(partBuf, Buffer.from("\r\n\r\n"), 0);
    if (headerEnd === -1) { start = end + boundaryBuf.length + 2; continue; }

    const headerStr = partBuf.slice(0, headerEnd).toString("utf-8");
    const body = partBuf.slice(headerEnd + 4);

    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const fileMatch = headerStr.match(/filename="([^"]*)"/);

    parts.push({
      name: nameMatch ? nameMatch[1] : "",
      filename: fileMatch ? fileMatch[1] : null,
      data: body,
    });

    start = end + boundaryBuf.length;
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break;
    start += 2;
  }
  return parts;
}

// ── File listing helper ──────────────────────────────────────────────────────

function listFiles(dirPath, category, baseDir) {
  if (!fs.existsSync(dirPath)) return [];
  const root = baseDir || dirPath;
  try {
    const results = [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const d of entries) {
      if (d.name.startsWith(".")) continue;
      const fullPath = path.join(dirPath, d.name);
      if (d.isFile()) {
        const stat = fs.lstatSync(fullPath);
        const relName = root !== dirPath ? path.relative(root, fullPath) : d.name;
        results.push({
          name: relName,
          path: fullPath,
          size: stat.size,
          dir: category,
          isGlobalRef: stat.isSymbolicLink(),
        });
      } else if (d.isDirectory() && category !== "other") {
        results.push(...listFiles(fullPath, category, root));
      }
    }
    return results;
  } catch {
    return [];
  }
}

// ── Route handler ────────────────────────────────────────────────────────────

export function handle(req, res, url) {
  const p = url.pathname;
  const m = req.method;

  // GET /api/data/status
  if (p === "/api/data/status" && m === "GET") {
    handleDataStatus(req, res, url);
    return true;
  }
  // POST /api/data/upload
  if (p === "/api/data/upload" && m === "POST") {
    handleDataUpload(req, res, url);
    return true;
  }
  // POST /api/data/global
  if (p === "/api/data/global" && m === "POST") {
    handleDataGlobal(req, res, url);
    return true;
  }

  return false;
}

// ── GET /api/data/status ─────────────────────────────────────────────────────

async function handleDataStatus(req, res, url) {
  try {
    const workDir = url.searchParams.get("workDir");
    const scope = url.searchParams.get("scope") || "project";

    // Global scope
    if (scope === "global") {
      if (!isSetUp()) {
        return json(res, {
          configured: false,
          totalFiles: 0,
          rawFiles: [],
          formattedFiles: [],
          hasSkillsMd: false,
          unformatted: [],
        });
      }
      const status = getGlobalDataStatus();
      return json(res, { configured: true, ...status });
    }

    // Project scope
    if (!workDir) {
      return json(res, { error: "workDir required" }, 400);
    }

    const dataDir = path.join(workDir, "data");
    const rawDir = path.join(dataDir, "raw");
    const formattedDir = path.join(dataDir, "formatted");

    const rawFiles = listFiles(rawDir, "raw");
    const formattedFiles = listFiles(formattedDir, "formatted");
    const rootFiles = listFiles(dataDir, "other").filter(
      (f) => f.name !== ".DS_Store"
    );

    const manifestPath = path.join(workDir, "CLAUDE.md");
    const hasManifest = fs.existsSync(manifestPath);

    const totalFiles = rawFiles.length + formattedFiles.length + rootFiles.length;

    let phase = "idle";
    if (totalFiles === 0) phase = "idle";
    else if (rawFiles.length > 0 && formattedFiles.length === 0) phase = "raw";
    else if (formattedFiles.length > 0 && !hasManifest) phase = "formatted";
    else if (hasManifest) phase = "ready";

    json(res, {
      totalFiles,
      rawFiles,
      formattedFiles,
      rootFiles,
      hasManifest,
      phase,
    });
  } catch (err) {
    json(res, { error: String(err) }, 500);
  }
}

// ── POST /api/data/upload (multipart) ────────────────────────────────────────

async function handleDataUpload(req, res) {
  try {
    const contentType = req.headers["content-type"] || "";
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (!boundaryMatch) {
      return json(res, { error: "Missing multipart boundary" }, 400);
    }

    const buf = await rawBody(req);
    const parts = parseMultipart(buf, boundaryMatch[1]);

    let workDir = "";
    let scope = "project";
    const files = [];
    const relativePaths = [];

    for (const part of parts) {
      if (part.name === "workDir") {
        workDir = part.data.toString("utf-8");
      } else if (part.name === "scope") {
        scope = part.data.toString("utf-8");
      } else if (part.name === "relativePaths") {
        relativePaths.push(part.data.toString("utf-8"));
      } else if (part.name === "files" && part.filename) {
        files.push({ filename: part.filename, data: part.data });
      }
    }

    let rawDir;

    if (scope === "global") {
      if (!isSetUp()) setupGlobalConfig();
      ensureSharedDataDirs();
      rawDir = path.join(SHARED_DATA_DIR, "raw");
    } else {
      if (!workDir) {
        return json(res, { error: "workDir required for project scope" }, 400);
      }
      rawDir = path.join(workDir, "data", "raw");
      fs.mkdirSync(rawDir, { recursive: true });
      fs.mkdirSync(path.join(workDir, "data", "formatted"), { recursive: true });
    }

    const saved = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relPath = relativePaths[i] || file.filename;
      const sanitized = relPath.replace(/\.\.\//g, "").replace(/^\//g, "");
      const filePath = path.join(rawDir, sanitized);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, file.data);
      saved.push(filePath);
    }

    json(res, {
      uploaded: saved.length,
      scope,
      files: saved.map((p) => path.relative(rawDir, p)),
    });
  } catch (err) {
    console.error("[upload] Error:", err);
    json(res, { error: err instanceof Error ? err.message : "Upload failed" }, 500);
  }
}

// ── POST /api/data/global ────────────────────────────────────────────────────

async function handleDataGlobal(req, res) {
  try {
    const body = await parseBody(req);
    const { action, fileName, projectDir } = body;

    if (action === "link") {
      if (!fileName || !projectDir) {
        return json(res, { error: "fileName and projectDir required" }, 400);
      }
      const dataDir = path.join(projectDir, "data", "formatted");
      const linkedPath = linkGlobalToProject(fileName, dataDir);
      return json(res, { linked: true, path: linkedPath });
    }

    json(res, { error: "action required (link)" }, 400);
  } catch (err) {
    json(res, { error: err instanceof Error ? err.message : "Failed" }, 500);
  }
}
