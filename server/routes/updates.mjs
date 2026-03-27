import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const ROOT = process.cwd(); // open-canvas repo root

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function gitCheck() {
  // Fetch latest from origin (quiet, no merge)
  await exec("git", ["fetch", "origin", "main", "--quiet"], { cwd: ROOT });

  // Count commits we're behind
  const { stdout } = await exec(
    "git",
    ["log", "HEAD..origin/main", "--oneline"],
    { cwd: ROOT }
  );

  const lines = stdout.trim().split("\n").filter(Boolean);
  return {
    behind: lines.length,
    commits: lines.slice(0, 10), // preview up to 10
  };
}

async function gitVerifyRemote() {
  const EXPECTED_REMOTE = "https://github.com/rodneymbrown1/OpenCanvas";

  // Get current remote URL for origin
  let remoteUrl = "";
  try {
    const { stdout } = await exec("git", ["remote", "get-url", "origin"], { cwd: ROOT });
    remoteUrl = stdout.trim();
  } catch {
    // origin doesn't exist — add it
    await exec("git", ["remote", "add", "origin", EXPECTED_REMOTE], { cwd: ROOT });
    remoteUrl = EXPECTED_REMOTE;
  }

  // Normalize: strip trailing .git for comparison
  const normalize = (u) => u.replace(/\.git$/, "").replace(/\/$/, "");
  if (normalize(remoteUrl) !== normalize(EXPECTED_REMOTE)) {
    await exec("git", ["remote", "set-url", "origin", EXPECTED_REMOTE], { cwd: ROOT });
    remoteUrl = EXPECTED_REMOTE;
  }

  // Get current branch
  const { stdout: branchOut } = await exec("git", ["branch", "--show-current"], { cwd: ROOT });
  const branch = branchOut.trim();

  return { remoteUrl, branch, expectedRemote: EXPECTED_REMOTE };
}

async function gitPull() {
  // Verify remote first
  const remote = await gitVerifyRemote();

  // Checkout main if not already on it
  if (remote.branch !== "main") {
    await exec("git", ["checkout", "main"], { cwd: ROOT });
  }

  const { stdout, stderr } = await exec(
    "git",
    ["pull", "origin", "main"],
    { cwd: ROOT }
  );
  return { stdout: stdout.trim(), stderr: stderr.trim(), ...remote };
}

export function handle(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;

  if (pathname === "/api/updates/check" && method === "GET") {
    gitCheck()
      .then((result) => json(res, { updateAvailable: result.behind > 0, ...result }))
      .catch((err) => json(res, { error: err.message }, 500));
    return true;
  }

  if (pathname === "/api/updates/verify" && method === "GET") {
    gitVerifyRemote()
      .then((result) => json(res, { ok: true, ...result }))
      .catch((err) => json(res, { error: err.message }, 500));
    return true;
  }

  if (pathname === "/api/updates/pull" && method === "POST") {
    gitPull()
      .then((result) => json(res, { ok: true, ...result }))
      .catch((err) => json(res, { error: err.message }, 500));
    return true;
  }

  return false;
}
