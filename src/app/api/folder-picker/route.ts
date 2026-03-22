import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export async function GET() {
  // Open native folder picker dialog
  const platform = process.platform;

  try {
    let selected = "";

    if (platform === "darwin") {
      // macOS: use osascript to open Finder folder picker
      selected = execSync(
        `osascript -e 'set theFolder to POSIX path of (choose folder with prompt "Select your Open Canvas workspace folder")' 2>/dev/null`,
        { encoding: "utf-8", timeout: 60000 }
      ).trim();
    } else if (platform === "win32") {
      // Windows: use PowerShell folder browser dialog
      selected = execSync(
        `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select your Open Canvas workspace folder'; $f.ShowDialog() | Out-Null; $f.SelectedPath"`,
        { encoding: "utf-8", timeout: 60000 }
      ).trim();
    } else {
      // Linux: try zenity
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
      return NextResponse.json({ path: selected });
    }
    return NextResponse.json({ path: null, cancelled: true });
  } catch {
    // User cancelled or dialog failed
    return NextResponse.json({ path: null, cancelled: true });
  }
}

export async function POST(req: NextRequest) {
  // Create a new workspace directory
  const { name, location } = await req.json();

  // Default location: ~/OpenCanvas/
  const baseDir = location || join(homedir(), "OpenCanvas");
  const workspacePath = name ? join(baseDir, name) : baseDir;

  try {
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
    return NextResponse.json({ path: workspacePath, created: true });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
