import fs from "fs";
import path from "path";
import { execFileSync, execFile, spawn } from "child_process";
import { readConfig } from "../../src/lib/config.js";
import { atomicWriteSync, atomicWriteBuffer } from "../lib/safe-write.mjs";

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
  // POST /api/files/write
  if (p === "/api/files/write" && m === "POST") {
    handleWriteFile(req, res);
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
  // POST /api/files/git-clone
  if (p === "/api/files/git-clone" && m === "POST") {
    handleGitClone(req, res);
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
      atomicWriteSync(filePath, "");
    }
    json(res, { path: filePath, created: true });
  } catch (err) {
    json(res, { error: String(err) }, 500);
  }
}

// ── POST /api/files/write ────────────────────────────────────────────────────

async function handleWriteFile(req, res) {
  try {
    const { path: filePath, content } = await parseBody(req);

    if (!filePath) {
      return json(res, { error: "No path provided" }, 400);
    }

    if (typeof content !== "string") {
      return json(res, { error: "content must be a string" }, 400);
    }

    if (!fs.existsSync(filePath)) {
      return json(res, { error: "File does not exist" }, 404);
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      return json(res, { error: "Cannot write to a directory" }, 400);
    }

    atomicWriteSync(filePath, content);
    json(res, { path: filePath, written: true });
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
      atomicWriteBuffer(filePath, file.data);
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

    // Resolve any existing symlinks so we always point at the real file,
    // avoiding chains when linking from a project that itself has linked data.
    let realSource = source;
    try {
      realSource = fs.realpathSync(source);
    } catch {
      // If realpath fails, fall back to the original path
    }

    if (fs.existsSync(linkPath)) {
      fs.unlinkSync(linkPath);
    }

    try {
      fs.symlinkSync(realSource, linkPath);
    } catch {
      fs.copyFileSync(realSource, linkPath);
    }

    json(res, { linked: true, source: realSource, linkPath });
  } catch (err) {
    json(res, { error: err instanceof Error ? err.message : "Link failed" }, 500);
  }
}

// ── POST /api/files/git-clone ─────────────────────────────────────────────

async function handleGitClone(req, res) {
  try {
    const { url: repoUrl, targetDir } = await parseBody(req);

    if (!repoUrl || !targetDir) {
      return json(res, { error: "url and targetDir required" }, 400);
    }

    // Validate URL looks like a git repo (HTTPS or SSH)
    const validUrl = /^https?:\/\/.+\.git$|^https?:\/\/github\.com\/.+|^git@.+:.+\.git$/;
    if (!validUrl.test(repoUrl)) {
      return json(res, { error: "Invalid git repository URL. Use an HTTPS URL (e.g. https://github.com/user/repo.git)" }, 400);
    }

    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
      return json(res, { error: "Target directory not found" }, 404);
    }

    const repoName = path.basename(repoUrl.replace(/\.git$/, ""));
    const clonedPath = path.join(targetDir, repoName);

    // Check if destination already exists
    if (fs.existsSync(clonedPath)) {
      return json(res, { error: `Directory "${repoName}" already exists in the target folder` }, 400);
    }

    // Stream progress via SSE
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const sendEvent = (type, data) => {
      res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
    };

    const child = spawn(
      "git",
      ["-c", "http.postBuffer=524288000", "clone", "--progress", repoUrl],
      { cwd: targetDir, timeout: 600000 },
    );

    // Throttle progress events to avoid backpressure stalling git
    let stderrBuf = "";
    let lastProgressSend = 0;
    let pendingLine = "";

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderrBuf += text;

      // Throttle: send at most every 200ms to avoid backpressure on SSE
      const now = Date.now();
      const lines = text.split(/\r?\n|\r/).filter(Boolean);
      pendingLine = lines[lines.length - 1] || pendingLine;

      if (now - lastProgressSend >= 200) {
        lastProgressSend = now;
        sendEvent("progress", pendingLine);
        pendingLine = "";
      }
    });

    child.stdout.on("data", (chunk) => {
      const lines = chunk.toString().split(/\r?\n|\r/).filter(Boolean);
      for (const line of lines) {
        sendEvent("progress", line);
      }
    });

    child.on("close", (code, signal) => {
      // Flush any remaining progress line
      if (pendingLine) sendEvent("progress", pendingLine);

      if (code === 0) {
        sendEvent("done", { cloned: true, url: repoUrl, path: clonedPath });
      } else {
        const lowerErr = stderrBuf.toLowerCase();

        // Detect timeout / signal kill (code is null when killed by signal)
        if (code === null || signal) {
          sendEvent("error", {
            message: `Git clone timed out or was interrupted (signal: ${signal || "unknown"}). The repository may be too large or the connection too slow.`,
            authRequired: false,
          });
        // Detect authentication / permission errors
        } else {
          const isAuthError =
            lowerErr.includes("repository not found") ||
            lowerErr.includes("authentication failed") ||
            lowerErr.includes("could not read username") ||
            lowerErr.includes("permission denied") ||
            lowerErr.includes("terminal prompts disabled") ||
            (code === 128 && lowerErr.includes("fatal:"));

          // Detect network / transfer errors
          const isNetworkError =
            lowerErr.includes("early eof") ||
            lowerErr.includes("unexpected disconnect") ||
            lowerErr.includes("the remote end hung up");

          let message = `Git clone failed with exit code ${code}`;
          if (isNetworkError) {
            message = "Git clone failed: connection interrupted during transfer. This can happen with large repositories on slow connections. Try again — it may succeed on retry.";
          }

          sendEvent("error", { message, authRequired: isAuthError });
        }
      }

      // Clean up partial clone directory on failure
      if (code !== 0 && fs.existsSync(clonedPath)) {
        try { fs.rmSync(clonedPath, { recursive: true, force: true }); } catch {}
      }

      res.end();
    });

    child.on("error", (err) => {
      sendEvent("error", `Git clone failed: ${err.message}`);
      res.end();
    });
  } catch (err) {
    // If headers haven't been sent yet, respond with JSON error
    if (!res.headersSent) {
      json(res, {
        error: `Git clone failed: ${err instanceof Error ? err.message : String(err)}`,
      }, 500);
    } else {
      try {
        res.write(`data: ${JSON.stringify({ type: "error", data: err instanceof Error ? err.message : String(err) })}\n\n`);
      } catch {}
      res.end();
    }
  }
}
