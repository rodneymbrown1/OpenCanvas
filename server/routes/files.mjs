import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { readConfig } from "../../src/lib/config.js";

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

// ── Multipart parser (raw buffer) ────────────────────────────────────────────

function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipart(buf, boundary) {
  const parts = [];
  const boundaryBuf = Buffer.from(`--${boundary}`);
  let start = bufferIndexOf(buf, boundaryBuf, 0);
  if (start === -1) return parts;
  start += boundaryBuf.length + 2; // skip boundary + CRLF

  while (true) {
    const end = bufferIndexOf(buf, boundaryBuf, start);
    if (end === -1) break;

    const partBuf = buf.slice(start, end - 2); // strip trailing CRLF before boundary
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
    // skip CRLF or -- after boundary
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break; // "--" means end
    start += 2; // skip CRLF
  }
  return parts;
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

// ── File tree builder ────────────────────────────────────────────────────────

const IGNORED = new Set([
  "node_modules", ".next", ".git", "__pycache__", ".DS_Store", ".env",
]);

function buildTree(dirPath, depth = 0) {
  if (depth > 5) return [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter((e) => !IGNORED.has(e.name) && !e.name.startsWith("."))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      })
      .map((entry) => {
        const fullPath = path.join(dirPath, entry.name);
        const isSymlink = entry.isSymbolicLink();
        let isDir = entry.isDirectory();
        if (isSymlink && !isDir) {
          try { isDir = fs.statSync(fullPath).isDirectory(); } catch {}
        }
        if (isDir) {
          return {
            name: entry.name,
            path: fullPath,
            type: "directory",
            ...(isSymlink && { isSymlink: true }),
            children: buildTree(fullPath, depth + 1),
          };
        }
        return {
          name: entry.name,
          path: fullPath,
          type: "file",
          ...(isSymlink && { isSymlink: true }),
        };
      });
  } catch {
    return [];
  }
}

// ── Route handler ────────────────────────────────────────────────────────────

export function handle(req, res, url) {
  const p = url.pathname;
  const m = req.method;

  // GET /api/files
  if (p === "/api/files" && m === "GET") {
    handleListFiles(req, res, url);
    return true;
  }
  // GET /api/files/read
  if (p === "/api/files/read" && m === "GET") {
    handleReadFile(req, res, url);
    return true;
  }
  // POST /api/files/create
  if (p === "/api/files/create" && m === "POST") {
    handleCreateFile(req, res, url);
    return true;
  }
  // POST /api/files/delete
  if (p === "/api/files/delete" && m === "POST") {
    handleDeleteFile(req, res, url);
    return true;
  }
  // POST /api/files/move
  if (p === "/api/files/move" && m === "POST") {
    handleMoveFile(req, res, url);
    return true;
  }
  // POST /api/files/upload
  if (p === "/api/files/upload" && m === "POST") {
    handleUploadFile(req, res, url);
    return true;
  }
  // POST /api/files/reveal
  if (p === "/api/files/reveal" && m === "POST") {
    handleRevealFile(req, res, url);
    return true;
  }
  // POST /api/files/link
  if (p === "/api/files/link" && m === "POST") {
    handleLinkFile(req, res, url);
    return true;
  }

  return false;
}

// ── GET /api/files ───────────────────────────────────────────────────────────

async function handleListFiles(req, res, url) {
  try {
    const dirParam = url.searchParams.get("dir");
    const config = readConfig();
    const dir = dirParam || config.workspace.root;

    if (!dir) {
      return json(res, { error: "No workspace directory set" }, 400);
    }

    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {
        return json(res, { error: "Directory does not exist and could not be created" }, 404);
      }
    }

    const tree = buildTree(dir);
    json(res, { root: dir, tree });
  } catch (err) {
    json(res, { error: String(err) }, 500);
  }
}

// ── GET /api/files/read ──────────────────────────────────────────────────────

async function handleReadFile(req, res, url) {
  const filePath = url.searchParams.get("path");
  if (!filePath) {
    return json(res, { error: "No path provided" }, 400);
  }

  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 2 * 1024 * 1024) {
      return json(res, { error: "File too large (>2MB)" }, 413);
    }
    const content = fs.readFileSync(filePath, "utf-8");
    json(res, { path: filePath, content });
  } catch {
    json(res, { error: "Failed to read file" }, 500);
  }
}

// ── POST /api/files/create ───────────────────────────────────────────────────

async function handleCreateFile(req, res) {
  try {
    const { path: filePath, type } = await parseBody(req);

    if (!filePath) {
      return json(res, { error: "No path provided" }, 400);
    }

    if (fs.existsSync(filePath)) {
      return json(res, { error: "Already exists" }, 409);
    }

    if (type === "directory") {
      fs.mkdirSync(filePath, { recursive: true });
    } else {
      fs.writeFileSync(filePath, "", "utf-8");
    }
    json(res, { path: filePath, created: true });
  } catch (err) {
    json(res, { error: String(err) }, 500);
  }
}

// ── POST /api/files/delete ───────────────────────────────────────────────────

async function handleDeleteFile(req, res) {
  try {
    const { path: filePath } = await parseBody(req);

    if (!filePath) {
      return json(res, { error: "No path provided" }, 400);
    }

    if (!fs.existsSync(filePath)) {
      return json(res, { error: "Does not exist" }, 404);
    }

    const stat = fs.statSync(filePath);
    fs.rmSync(filePath, { recursive: stat.isDirectory(), force: true });
    json(res, { path: filePath, deleted: true });
  } catch (err) {
    json(res, { error: String(err) }, 500);
  }
}

// ── POST /api/files/move ─────────────────────────────────────────────────────

async function handleMoveFile(req, res) {
  try {
    const { source, destination } = await parseBody(req);

    if (!source || !destination) {
      return json(res, { error: "source and destination required" }, 400);
    }

    if (!fs.existsSync(source)) {
      return json(res, { error: "Source not found" }, 404);
    }

    let target = destination;
    if (fs.existsSync(destination) && fs.statSync(destination).isDirectory()) {
      target = path.join(destination, path.basename(source));
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(source, target);

    json(res, { moved: true, from: source, to: target });
  } catch (err) {
    json(res, { error: err instanceof Error ? err.message : "Move failed" }, 500);
  }
}

// ── POST /api/files/upload (multipart) ───────────────────────────────────────

async function handleUploadFile(req, res) {
  try {
    const contentType = req.headers["content-type"] || "";
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (!boundaryMatch) {
      return json(res, { error: "Missing multipart boundary" }, 400);
    }

    const buf = await rawBody(req);
    const parts = parseMultipart(buf, boundaryMatch[1]);

    let targetDir = "";
    const files = [];
    const relativePaths = [];

    for (const part of parts) {
      if (part.name === "targetDir") {
        targetDir = part.data.toString("utf-8");
      } else if (part.name === "relativePaths") {
        relativePaths.push(part.data.toString("utf-8"));
      } else if (part.name === "files" && part.filename) {
        files.push({ filename: part.filename, data: part.data });
      }
    }

    if (!targetDir) {
      return json(res, { error: "targetDir required" }, 400);
    }

    fs.mkdirSync(targetDir, { recursive: true });
    const saved = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relPath = relativePaths[i] || file.filename;
      const sanitized = relPath.replace(/\.\.\//g, "").replace(/^\//g, "");
      const filePath = path.join(targetDir, sanitized);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, file.data);
      saved.push(filePath);
    }

    json(res, {
      uploaded: saved.length,
      files: saved.map((p) => path.relative(targetDir, p)),
    });
  } catch (err) {
    json(res, { error: err instanceof Error ? err.message : "Upload failed" }, 500);
  }
}

// ── POST /api/files/reveal ───────────────────────────────────────────────────

async function handleRevealFile(req, res) {
  try {
    const { path: targetPath } = await parseBody(req);

    if (!targetPath) {
      return json(res, { error: "path required" }, 400);
    }

    if (!fs.existsSync(targetPath)) {
      return json(res, { error: "Path does not exist" }, 404);
    }

    const platform = process.platform;
    const isDir = fs.statSync(targetPath).isDirectory();

    if (platform === "darwin") {
      if (isDir) {
        execFileSync("open", [targetPath]);
      } else {
        execFileSync("open", ["-R", targetPath]);
      }
    } else if (platform === "win32") {
      if (isDir) {
        execFileSync("explorer", [targetPath]);
      } else {
        execFileSync("explorer", ["/select,", targetPath]);
      }
    } else {
      const dir = isDir ? targetPath : path.dirname(targetPath);
      execFileSync("xdg-open", [dir]);
    }

    json(res, { revealed: true, path: targetPath });
  } catch (err) {
    json(res, {
      error: `Failed to reveal: ${err instanceof Error ? err.message : String(err)}`,
    }, 500);
  }
}

// ── POST /api/files/link ─────────────────────────────────────────────────────

async function handleLinkFile(req, res) {
  try {
    const { source, targetDir } = await parseBody(req);

    if (!source || !targetDir) {
      return json(res, { error: "source and targetDir required" }, 400);
    }

    if (!fs.existsSync(source)) {
      return json(res, { error: "Source not found" }, 404);
    }

    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
      return json(res, { error: "Target directory not found" }, 404);
    }

    const linkPath = path.join(targetDir, path.basename(source));

    if (fs.existsSync(linkPath)) {
      fs.unlinkSync(linkPath);
    }

    try {
      fs.symlinkSync(source, linkPath);
    } catch {
      fs.copyFileSync(source, linkPath);
    }

    json(res, { linked: true, source, linkPath });
  } catch (err) {
    json(res, { error: err instanceof Error ? err.message : "Link failed" }, 500);
  }
}
