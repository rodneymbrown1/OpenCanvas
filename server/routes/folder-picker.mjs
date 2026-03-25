import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

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

// ── Route handler ────────────────────────────────────────────────────────────

export function handle(req, res, url) {
  const p = url.pathname;
  const m = req.method;

  if (p === "/api/folder-picker" && m === "GET") {
    handleGetFolderPicker(req, res, url);
    return true;
  }

  if (p === "/api/folder-picker" && m === "POST") {
    handlePostFolderPicker(req, res, url);
    return true;
  }

  return false;
}

// ── GET /api/folder-picker ───────────────────────────────────────────────────

async function handleGetFolderPicker(req, res) {
  const platform = process.platform;

  try {
    let selected = "";

    if (platform === "darwin") {
      selected = execSync(
        `osascript -e 'set theFolder to POSIX path of (choose folder with prompt "Select your Open Canvas workspace folder")' 2>/dev/null`,
        { encoding: "utf-8", timeout: 60000 }
      ).trim();
    } else if (platform === "win32") {
      selected = execSync(
        `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select your Open Canvas workspace folder'; $f.ShowDialog() | Out-Null; $f.SelectedPath"`,
        { encoding: "utf-8", timeout: 60000 }
      ).trim();
    } else {
      selected = execSync(
        `zenity --file-selection --directory --title="Select workspace folder" 2>/dev/null`,
        { encoding: "utf-8", timeout: 60000 }
      ).trim();
    }

    // Remove trailing slash
    if (selected.endsWith("/") && selected.length > 1) {
      selected = selected.slice(0, -1);
    }

    if (selected) {
      return json(res, { path: selected });
    }
    json(res, { path: null, cancelled: true });
  } catch {
    json(res, { path: null, cancelled: true });
  }
}

// ── POST /api/folder-picker ─────────────────────────────────────────────────

async function handlePostFolderPicker(req, res) {
  try {
    const { name, location } = await parseBody(req);

    const baseDir = location || join(homedir(), "OpenCanvas");
    const workspacePath = name ? join(baseDir, name) : baseDir;

    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true });
    }
    if (!existsSync(workspacePath)) {
      mkdirSync(workspacePath, { recursive: true });
    }

    // Create default subdirectories
    const subdirs = ["data", "apps"];
    for (const dir of subdirs) {
      const p = join(workspacePath, dir);
      if (!existsSync(p)) {
        mkdirSync(p, { recursive: true });
      }
    }

    json(res, { path: workspacePath, created: true });
  } catch (err) {
    json(res, { error: String(err) }, 500);
  }
}
