import { execFile, spawn } from "child_process";

// ── Helpers ──────────────────────────────────────────────────────────────────

function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

// ── Route handler ────────────────────────────────────────────────────────────

export function handle(req, res, url) {
  const p = url.pathname;
  const m = req.method;

  if (p === "/api/github-auth/status" && m === "GET") {
    handleStatus(req, res);
    return true;
  }
  if (p === "/api/github-auth/login" && m === "POST") {
    handleLogin(req, res);
    return true;
  }
  if (p === "/api/github-auth/logout" && m === "POST") {
    handleLogout(req, res);
    return true;
  }

  return false;
}

// ── GET /api/github-auth/status ──────────────────────────────────────────────

async function handleStatus(_req, res) {
  try {
    // First check if gh CLI is installed
    const ghInstalled = await new Promise((resolve) => {
      execFile("which", ["gh"], (err) => resolve(!err));
    });

    if (!ghInstalled) {
      return json(res, {
        authenticated: false,
        ghInstalled: false,
        message: "GitHub CLI (gh) is not installed",
      });
    }

    // Check auth status
    const result = await new Promise((resolve) => {
      execFile(
        "gh",
        ["auth", "status", "--hostname", "github.com"],
        { timeout: 10000 },
        (err, stdout, stderr) => {
          const output = (stdout || "") + (stderr || "");
          if (err) {
            resolve({ authenticated: false, output });
          } else {
            resolve({ authenticated: true, output });
          }
        }
      );
    });

    // Parse username from output
    let username = null;
    const userMatch = result.output.match(/Logged in to github\.com.*?account\s+(\S+)/i)
      || result.output.match(/Logged in to github\.com as (\S+)/i)
      || result.output.match(/account\s+(\S+)/i);
    if (userMatch) username = userMatch[1];

    return json(res, {
      authenticated: result.authenticated,
      ghInstalled: true,
      username,
      message: result.authenticated
        ? `Authenticated as ${username || "unknown"}`
        : "Not authenticated with GitHub",
    });
  } catch (err) {
    json(res, { authenticated: false, ghInstalled: false, error: err.message }, 500);
  }
}

// ── POST /api/github-auth/login ──────────────────────────────────────────────

async function handleLogin(_req, res) {
  try {
    // Check if gh is installed
    const ghInstalled = await new Promise((resolve) => {
      execFile("which", ["gh"], (err) => resolve(!err));
    });

    if (!ghInstalled) {
      return json(res, {
        error: "GitHub CLI (gh) is not installed. Install it with: brew install gh",
      }, 400);
    }

    // Stream the auth flow via SSE
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const sendEvent = (type, data) => {
      res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
    };

    const child = spawn("gh", ["auth", "login", "--web", "--git-protocol", "https", "--hostname", "github.com"], {
      timeout: 300000, // 5 min timeout for user to complete browser flow
      env: { ...process.env, GH_PROMPT_DISABLED: "1" },
    });

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      const lines = text.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        // Check for the one-time code
        const codeMatch = line.match(/one-time code:\s*(\S+)/i);
        if (codeMatch) {
          sendEvent("code", codeMatch[1]);
        }
        sendEvent("progress", line);
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      const lines = text.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const codeMatch = line.match(/one-time code:\s*(\S+)/i);
        if (codeMatch) {
          sendEvent("code", codeMatch[1]);
        }
        sendEvent("progress", line);
      }
    });

    child.on("close", (code) => {
      if (code === 0) {
        sendEvent("done", { success: true });
      } else {
        sendEvent("error", `Authentication failed (exit code ${code})`);
      }
      res.end();
    });

    child.on("error", (err) => {
      sendEvent("error", err.message);
      res.end();
    });
  } catch (err) {
    if (!res.headersSent) {
      json(res, { error: err.message }, 500);
    } else {
      try {
        res.write(`data: ${JSON.stringify({ type: "error", data: err.message })}\n\n`);
      } catch {}
      res.end();
    }
  }
}

// ── POST /api/github-auth/logout ─────────────────────────────────────────────

async function handleLogout(_req, res) {
  try {
    await new Promise((resolve, reject) => {
      execFile(
        "gh",
        ["auth", "logout", "--hostname", "github.com"],
        { timeout: 10000, env: { ...process.env, GH_PROMPT_DISABLED: "1" } },
        (err) => (err ? reject(err) : resolve())
      );
    });
    json(res, { loggedOut: true });
  } catch (err) {
    // gh auth logout may "fail" if already logged out
    json(res, { loggedOut: true, note: err.message });
  }
}
