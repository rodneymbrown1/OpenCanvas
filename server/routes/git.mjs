import fs from "fs";
import path from "path";
import { execFile, spawn } from "child_process";
import { log, logError } from "../logger.mjs";

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); } catch (e) { reject(e); }
    });
  });
}

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
  return true;
}

function gitExec(repoPath, args, timeout = 30000) {
  log("git", `exec: git ${args.join(" ")}`, { cwd: repoPath });
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd: repoPath, timeout }, (err, stdout, stderr) => {
      if (err) {
        logError("git", `exec FAILED: git ${args.join(" ")}`, { cwd: repoPath, stderr: stderr?.slice(0, 500) });
        reject(new Error(stderr || err.message));
      } else {
        log("git", `exec OK: git ${args.join(" ")}`, { bytes: stdout.length });
        resolve(stdout.trimEnd());
      }
    });
  });
}

/** Validate repoPath exists and is a git repo */
function validateRepo(repoPath) {
  if (!repoPath || typeof repoPath !== "string") return "repoPath is required";
  if (!fs.existsSync(repoPath)) return "Path does not exist";
  if (!fs.existsSync(path.join(repoPath, ".git"))) return "Not a git repository";
  return null;
}

/** SSE streaming helper for long git operations (push/pull/fetch) */
function streamGitOp(res, repoPath, args, timeoutMs = 120000) {
  log("git", `stream: git ${args.join(" ")}`, { cwd: repoPath, timeoutMs });
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const sendEvent = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  };

  const child = spawn("git", args, { cwd: repoPath, timeout: timeoutMs });

  let stderrBuf = "";
  let lastProgressSend = 0;
  let pendingLine = "";

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderrBuf += text;
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
    for (const line of lines) sendEvent("progress", line);
  });

  child.on("close", (code, signal) => {
    if (pendingLine) sendEvent("progress", pendingLine);
    if (code === 0) {
      log("git", `stream OK: git ${args.join(" ")}`);
      sendEvent("done", { success: true });
    } else {
      logError("git", `stream FAILED: git ${args.join(" ")}`, { code, signal, stderr: stderrBuf.slice(0, 500) });
      const lowerErr = stderrBuf.toLowerCase();
      const isAuthError =
        lowerErr.includes("repository not found") ||
        lowerErr.includes("authentication failed") ||
        lowerErr.includes("could not read username") ||
        lowerErr.includes("permission denied") ||
        lowerErr.includes("terminal prompts disabled") ||
        (code === 128 && lowerErr.includes("fatal:"));
      sendEvent("error", {
        message: stderrBuf.trim() || `Git operation failed (exit code ${code})`,
        authRequired: isAuthError,
      });
    }
    res.end();
  });

  child.on("error", (err) => {
    sendEvent("error", { message: err.message, authRequired: false });
    res.end();
  });

  return true;
}

// ── Route Handler ────────────────────────────────────────────────────────────

export async function handle(req, res) {
  const { method, url } = req;
  const parsed = new URL(url, "http://localhost");
  const p = parsed.pathname;

  // Only handle /api/git/* routes
  if (!p.startsWith("/api/git/")) return false;

  log("git", `${method} ${p}`, { query: parsed.search || undefined });

  // ── GET /api/git/detect ──
  if (method === "GET" && p === "/api/git/detect") {
    const dirPath = parsed.searchParams.get("path");
    if (!dirPath) return json(res, { error: "path required" }, 400);
    const isRepo = fs.existsSync(path.join(dirPath, ".git"));
    log("git", `detect: ${dirPath} → isRepo=${isRepo}`);
    return json(res, { isRepo });
  }

  // ── GET /api/git/status ──
  if (method === "GET" && p === "/api/git/status") {
    const repoPath = parsed.searchParams.get("path");
    log("git", `status request`, { repoPath });
    const err = validateRepo(repoPath);
    if (err) { logError("git", `status validation failed`, { repoPath, err }); return json(res, { error: err }, 400); }
    try {
      const branchOut = await gitExec(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
      const statusOut = await gitExec(repoPath, ["status", "--porcelain"]);
      const lines = statusOut ? statusOut.split("\n") : [];
      let staged = 0, modified = 0, untracked = 0;
      for (const line of lines) {
        const x = line[0], y = line[1];
        if (x === "?") { untracked++; continue; }
        if (x !== " " && x !== "?") staged++;
        if (y !== " " && y !== "?") modified++;
      }

      let ahead = 0, behind = 0;
      try {
        const counts = await gitExec(repoPath, ["rev-list", "--left-right", "--count", `HEAD...@{upstream}`]);
        const parts = counts.split(/\s+/);
        ahead = parseInt(parts[0]) || 0;
        behind = parseInt(parts[1]) || 0;
      } catch {}

      let lastCommit = null;
      try {
        const logOut = await gitExec(repoPath, ["log", "-1", "--format=%H%n%h%n%s%n%an%n%ar"]);
        const logParts = logOut.split("\n");
        if (logParts.length >= 5) {
          lastCommit = { hash: logParts[0], shortHash: logParts[1], message: logParts[2], author: logParts[3], date: logParts[4] };
        }
      } catch {}

      return json(res, {
        branch: branchOut,
        isClean: lines.length === 0,
        staged, modified, untracked,
        ahead, behind,
        lastCommit,
      });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // ── GET /api/git/branches ──
  if (method === "GET" && p === "/api/git/branches") {
    const repoPath = parsed.searchParams.get("path");
    const err = validateRepo(repoPath);
    if (err) return json(res, { error: err }, 400);
    try {
      const currentBranch = await gitExec(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
      const localOut = await gitExec(repoPath, ["branch", "--format=%(refname:short)"]);
      const local = localOut ? localOut.split("\n").map((b) => ({
        name: b, current: b === currentBranch, remote: false,
      })) : [];

      let remotes = [];
      try {
        const remoteOut = await gitExec(repoPath, ["branch", "-r", "--format=%(refname:short)"]);
        remotes = remoteOut ? remoteOut.split("\n")
          .filter((b) => !b.includes("HEAD"))
          .map((b) => ({ name: b, current: false, remote: true })) : [];
      } catch {}

      return json(res, { branches: [...local, ...remotes] });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // ── POST /api/git/checkout ──
  if (method === "POST" && p === "/api/git/checkout") {
    const { repoPath, branch } = await parseBody(req);
    const err = validateRepo(repoPath);
    if (err) return json(res, { error: err }, 400);
    if (!branch) return json(res, { error: "branch is required" }, 400);
    try {
      await gitExec(repoPath, ["checkout", branch]);
      return json(res, { success: true, branch });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // ── POST /api/git/create-branch ──
  if (method === "POST" && p === "/api/git/create-branch") {
    const { repoPath, name, checkout = true } = await parseBody(req);
    const err = validateRepo(repoPath);
    if (err) return json(res, { error: err }, 400);
    if (!name || !/^[a-zA-Z0-9._\-/]+$/.test(name)) return json(res, { error: "Invalid branch name" }, 400);
    try {
      const args = checkout ? ["checkout", "-b", name] : ["branch", name];
      await gitExec(repoPath, args);
      return json(res, { success: true, branch: name });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // ── POST /api/git/delete-branch ──
  if (method === "POST" && p === "/api/git/delete-branch") {
    const { repoPath, name, force = false } = await parseBody(req);
    const err = validateRepo(repoPath);
    if (err) return json(res, { error: err }, 400);
    if (!name) return json(res, { error: "branch name required" }, 400);
    try {
      const currentBranch = await gitExec(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
      if (name === currentBranch) return json(res, { error: "Cannot delete the current branch" }, 400);
      await gitExec(repoPath, ["branch", force ? "-D" : "-d", name]);
      return json(res, { success: true });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // ── GET /api/git/remotes ──
  if (method === "GET" && p === "/api/git/remotes") {
    const repoPath = parsed.searchParams.get("path");
    const err = validateRepo(repoPath);
    if (err) return json(res, { error: err }, 400);
    try {
      const out = await gitExec(repoPath, ["remote", "-v"]);
      const remoteMap = new Map();
      for (const line of (out || "").split("\n").filter(Boolean)) {
        const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
        if (match) {
          const [, name, url, type] = match;
          if (!remoteMap.has(name)) remoteMap.set(name, { name, fetchUrl: "", pushUrl: "" });
          const remote = remoteMap.get(name);
          if (type === "fetch") remote.fetchUrl = url;
          else remote.pushUrl = url;
        }
      }
      return json(res, { remotes: Array.from(remoteMap.values()) });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // ── POST /api/git/remote-add ──
  if (method === "POST" && p === "/api/git/remote-add") {
    const { repoPath, name, url } = await parseBody(req);
    const err = validateRepo(repoPath);
    if (err) return json(res, { error: err }, 400);
    if (!name || !url) return json(res, { error: "name and url required" }, 400);
    try {
      await gitExec(repoPath, ["remote", "add", name, url]);
      return json(res, { success: true });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // ── POST /api/git/remote-remove ──
  if (method === "POST" && p === "/api/git/remote-remove") {
    const { repoPath, name } = await parseBody(req);
    const err = validateRepo(repoPath);
    if (err) return json(res, { error: err }, 400);
    if (!name) return json(res, { error: "remote name required" }, 400);
    try {
      await gitExec(repoPath, ["remote", "remove", name]);
      return json(res, { success: true });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // ── POST /api/git/remote-set-url ──
  if (method === "POST" && p === "/api/git/remote-set-url") {
    const { repoPath, name, url } = await parseBody(req);
    const err = validateRepo(repoPath);
    if (err) return json(res, { error: err }, 400);
    if (!name || !url) return json(res, { error: "name and url required" }, 400);
    try {
      await gitExec(repoPath, ["remote", "set-url", name, url]);
      return json(res, { success: true });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // ── GET /api/git/diff ──
  if (method === "GET" && p === "/api/git/diff") {
    const repoPath = parsed.searchParams.get("path");
    const err = validateRepo(repoPath);
    if (err) return json(res, { error: err }, 400);
    try {
      const statusOut = await gitExec(repoPath, ["status", "--porcelain"]);
      const changes = [];
      for (const line of (statusOut || "").split("\n").filter(Boolean)) {
        const x = line[0], y = line[1];
        const filePath = line.slice(3).trim().replace(/^"(.*)"$/, "$1");
        if (x === "?" && y === "?") {
          changes.push({ path: filePath, status: "?", staged: false });
        } else {
          if (x !== " " && x !== "?") {
            changes.push({ path: filePath, status: x, staged: true });
          }
          if (y !== " " && y !== "?") {
            changes.push({ path: filePath, status: y, staged: false });
          }
        }
      }
      return json(res, { changes });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // ── POST /api/git/stage ──
  if (method === "POST" && p === "/api/git/stage") {
    const { repoPath, files } = await parseBody(req);
    const err = validateRepo(repoPath);
    if (err) return json(res, { error: err }, 400);
    if (!files || !Array.isArray(files) || files.length === 0) return json(res, { error: "files array required" }, 400);
    try {
      await gitExec(repoPath, ["add", "--", ...files]);
      return json(res, { success: true });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // ── POST /api/git/unstage ──
  if (method === "POST" && p === "/api/git/unstage") {
    const { repoPath, files } = await parseBody(req);
    const err = validateRepo(repoPath);
    if (err) return json(res, { error: err }, 400);
    if (!files || !Array.isArray(files) || files.length === 0) return json(res, { error: "files array required" }, 400);
    try {
      await gitExec(repoPath, ["restore", "--staged", "--", ...files]);
      return json(res, { success: true });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // ── POST /api/git/commit ──
  if (method === "POST" && p === "/api/git/commit") {
    const { repoPath, message } = await parseBody(req);
    const err = validateRepo(repoPath);
    if (err) return json(res, { error: err }, 400);
    if (!message || !message.trim()) return json(res, { error: "commit message required" }, 400);
    try {
      await gitExec(repoPath, ["commit", "-m", message]);
      return json(res, { success: true });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // ── POST /api/git/push ──
  if (method === "POST" && p === "/api/git/push") {
    const { repoPath, remote, branch, setUpstream } = await parseBody(req);
    const err = validateRepo(repoPath);
    if (err) return json(res, { error: err }, 400);
    const args = ["push", "--progress"];
    if (setUpstream) args.push("-u");
    if (remote) args.push(remote);
    if (branch) args.push(branch);
    return streamGitOp(res, repoPath, args);
  }

  // ── POST /api/git/pull ──
  if (method === "POST" && p === "/api/git/pull") {
    const { repoPath, remote, branch } = await parseBody(req);
    const err = validateRepo(repoPath);
    if (err) return json(res, { error: err }, 400);
    const args = ["pull", "--progress"];
    if (remote) args.push(remote);
    if (branch) args.push(branch);
    return streamGitOp(res, repoPath, args);
  }

  // ── POST /api/git/fetch ──
  if (method === "POST" && p === "/api/git/fetch") {
    const { repoPath } = await parseBody(req);
    const err = validateRepo(repoPath);
    if (err) return json(res, { error: err }, 400);
    return streamGitOp(res, repoPath, ["fetch", "--all", "--progress"]);
  }

  // ── GET /api/git/log ──
  if (method === "GET" && p === "/api/git/log") {
    const repoPath = parsed.searchParams.get("path");
    const count = parseInt(parsed.searchParams.get("count") || "50") || 50;
    const err = validateRepo(repoPath);
    if (err) return json(res, { error: err }, 400);
    try {
      const SEP = "---GIT_LOG_SEP---";
      const format = [`%H`, `%h`, `%s`, `%an`, `%ar`, `%D`].join(SEP);
      const out = await gitExec(repoPath, ["log", `--format=${format}`, `-n`, String(Math.min(count, 200))]);
      const entries = [];
      for (const line of (out || "").split("\n").filter(Boolean)) {
        const parts = line.split(SEP);
        if (parts.length >= 6) {
          entries.push({
            hash: parts[0], shortHash: parts[1], message: parts[2],
            author: parts[3], date: parts[4], refs: parts[5],
          });
        }
      }
      return json(res, { entries });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // ── GET /api/git/stash-list ──
  if (method === "GET" && p === "/api/git/stash-list") {
    const repoPath = parsed.searchParams.get("path");
    const err = validateRepo(repoPath);
    if (err) return json(res, { error: err }, 400);
    try {
      const out = await gitExec(repoPath, ["stash", "list", "--format=%gd%n%gs%n%ar"]);
      const stashes = [];
      const lines = (out || "").split("\n").filter(Boolean);
      for (let i = 0; i + 2 < lines.length; i += 3) {
        const indexMatch = lines[i].match(/stash@\{(\d+)\}/);
        stashes.push({
          index: indexMatch ? parseInt(indexMatch[1]) : stashes.length,
          message: lines[i + 1],
          date: lines[i + 2],
        });
      }
      return json(res, { stashes });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // ── POST /api/git/stash-save ──
  if (method === "POST" && p === "/api/git/stash-save") {
    const { repoPath, message } = await parseBody(req);
    const err = validateRepo(repoPath);
    if (err) return json(res, { error: err }, 400);
    try {
      const args = ["stash", "push"];
      if (message) args.push("-m", message);
      await gitExec(repoPath, args);
      return json(res, { success: true });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // ── POST /api/git/stash-apply ──
  if (method === "POST" && p === "/api/git/stash-apply") {
    const { repoPath, index = 0 } = await parseBody(req);
    const err = validateRepo(repoPath);
    if (err) return json(res, { error: err }, 400);
    try {
      await gitExec(repoPath, ["stash", "apply", `stash@{${index}}`]);
      return json(res, { success: true });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // ── POST /api/git/stash-drop ──
  if (method === "POST" && p === "/api/git/stash-drop") {
    const { repoPath, index = 0 } = await parseBody(req);
    const err = validateRepo(repoPath);
    if (err) return json(res, { error: err }, 400);
    try {
      await gitExec(repoPath, ["stash", "drop", `stash@{${index}}`]);
      return json(res, { success: true });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // ── GET /api/git/config ──
  if (method === "GET" && p === "/api/git/config") {
    const repoPath = parsed.searchParams.get("path");
    const err = validateRepo(repoPath);
    if (err) return json(res, { error: err }, 400);
    try {
      let userName = "", userEmail = "";
      try { userName = await gitExec(repoPath, ["config", "--local", "user.name"]); } catch {}
      try { userEmail = await gitExec(repoPath, ["config", "--local", "user.email"]); } catch {}
      // Fall back to global config
      if (!userName) try { userName = await gitExec(repoPath, ["config", "user.name"]); } catch {}
      if (!userEmail) try { userEmail = await gitExec(repoPath, ["config", "user.email"]); } catch {}
      return json(res, { userName, userEmail });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // ── POST /api/git/config ──
  if (method === "POST" && p === "/api/git/config") {
    const { repoPath, userName, userEmail } = await parseBody(req);
    const err = validateRepo(repoPath);
    if (err) return json(res, { error: err }, 400);
    try {
      if (userName !== undefined) await gitExec(repoPath, ["config", "--local", "user.name", userName]);
      if (userEmail !== undefined) await gitExec(repoPath, ["config", "--local", "user.email", userEmail]);
      return json(res, { success: true });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // Unmatched /api/git/* route
  logError("git", `unmatched route: ${method} ${p}`);
  return json(res, { error: `Unknown git endpoint: ${method} ${p}` }, 404);
}
