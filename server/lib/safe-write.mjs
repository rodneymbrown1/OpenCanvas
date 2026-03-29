/**
 * safe-write.mjs — Atomic file writes and in-process file locking.
 *
 * Two primitives:
 *   atomicWriteSync(filePath, content)  — crash-safe write via tmp+rename
 *   withFileLock(filePath, fn)          — async mutex per file path
 */

import fs from "fs";
import path from "path";

// ── Atomic Write ────────────────────────────────────────────────────────────

/**
 * Write content to filePath atomically: write to a temp file, then rename.
 * If the process crashes mid-write, the original file is untouched.
 */
export function atomicWriteSync(filePath, content, encoding = "utf-8") {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, content, encoding);
  fs.renameSync(tmpPath, filePath);
}

/**
 * Atomic write for JSON data (pretty-printed).
 */
export function atomicWriteJSON(filePath, data) {
  atomicWriteSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * Atomic write for binary/Buffer data.
 */
export function atomicWriteBuffer(filePath, buffer) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, buffer);
  fs.renameSync(tmpPath, filePath);
}

// ── In-Process File Mutex ───────────────────────────────────────────────────

/**
 * Map of file path → tail of the promise chain.
 * Each writer awaits the previous writer's promise before proceeding.
 * Since this is single-process Node.js, no OS-level locks are needed.
 */
const lockChains = new Map();

/**
 * Serialize async read-modify-write operations on the same file.
 *
 * Usage:
 *   await withFileLock("/path/to/file", async () => {
 *     const data = fs.readFileSync(file, "utf-8");
 *     // ... modify data ...
 *     atomicWriteSync(file, newData);
 *   });
 *
 * Multiple callers targeting different files run concurrently.
 * Multiple callers targeting the SAME file run serially.
 */
export async function withFileLock(filePath, fn) {
  const prev = lockChains.get(filePath) || Promise.resolve();

  let resolve;
  const next = new Promise((r) => {
    resolve = r;
  });
  lockChains.set(filePath, next);

  // Wait for previous operation on this file to finish
  await prev;

  try {
    return await fn();
  } finally {
    // Clean up if no one else queued behind us
    if (lockChains.get(filePath) === next) {
      lockChains.delete(filePath);
    }
    resolve();
  }
}
