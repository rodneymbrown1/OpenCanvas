// server/routes/calendar-connections.mjs — Calendar connection & sync API routes
// Supports two OAuth methods:
//   1. Direct OAuth (default) — local callback server, no CLI dependency
//   2. gcloud CLI fallback — uses Application Default Credentials

import { execFile, spawn } from "child_process";
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import {
  listConnections,
  addConnection,
  removeConnection,
  updateConnection,
  getConnection,
} from "../../src/lib/calendar/connections.js";
import { getProvider, listProviders } from "../../src/lib/calendar/providers/index.js";
import { syncConnection, pushEvent } from "../../src/lib/calendar/sync/CalendarSyncEngine.js";
import { readGlobalConfig } from "../../src/lib/globalConfig.js";
import { log, logWarn, logError } from "../logger.mjs";

const CAT = "calendar";

// Path where gcloud stores ADC credentials
const ADC_PATH = path.join(os.homedir(), ".config", "gcloud", "application_default_credentials.json");

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); }
      catch (e) { reject(e); }
    });
  });
}

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// ── gcloud helpers ─────────────────────────────────────────────────────────────

/** Check if gcloud CLI is installed and return its path */
function checkGcloud() {
  return new Promise((resolve) => {
    execFile("which", ["gcloud"], (err, stdout) => {
      if (err) {
        log(CAT, "gcloud CLI not found in PATH");
        resolve(null);
      } else {
        const p = stdout.trim();
        log(CAT, "gcloud CLI found at:", p);
        resolve(p);
      }
    });
  });
}

/** Attempt to install gcloud CLI via brew (macOS) */
function installGcloud(sendEvent) {
  return new Promise((resolve, reject) => {
    log(CAT, "Attempting gcloud install via brew...");
    sendEvent("progress", "Installing Google Cloud SDK via Homebrew...");

    const child = spawn("brew", ["install", "--cask", "google-cloud-sdk"], {
      timeout: 300000,
      env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: "1" },
    });

    child.stdout.on("data", (chunk) => {
      const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        log(CAT, "[brew stdout]", line);
        sendEvent("progress", line);
      }
    });

    child.stderr.on("data", (chunk) => {
      const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        log(CAT, "[brew stderr]", line);
        sendEvent("progress", line);
      }
    });

    child.on("close", async (code) => {
      if (code === 0) {
        log(CAT, "gcloud install completed successfully");
        sendEvent("progress", "Google Cloud SDK installed successfully.");
        // After cask install, gcloud may be at a brew-managed path; re-check
        const found = await checkGcloud();
        if (found) {
          resolve(found);
        } else {
          // Try common brew cask path
          const brewPath = "/opt/homebrew/bin/gcloud";
          const usrPath = "/usr/local/bin/gcloud";
          const caskPath = "/opt/homebrew/share/google-cloud-sdk/bin/gcloud";
          for (const p of [brewPath, usrPath, caskPath]) {
            if (fs.existsSync(p)) {
              log(CAT, "Found gcloud at fallback path:", p);
              resolve(p);
              return;
            }
          }
          logWarn(CAT, "gcloud installed but not found in expected paths");
          reject(new Error("gcloud installed but not found in PATH. You may need to restart your terminal."));
        }
      } else {
        logError(CAT, `brew install failed with exit code ${code}`);
        reject(new Error(`Failed to install Google Cloud SDK (exit code ${code})`));
      }
    });

    child.on("error", (err) => {
      logError(CAT, "brew install spawn error:", err.message);
      reject(err);
    });
  });
}

/** Read ADC credentials file */
function readADC() {
  try {
    if (!fs.existsSync(ADC_PATH)) {
      log(CAT, "ADC file not found at:", ADC_PATH);
      return null;
    }
    const raw = fs.readFileSync(ADC_PATH, "utf-8");
    const data = JSON.parse(raw);
    log(CAT, "ADC file read successfully, type:", data.type);
    return data;
  } catch (err) {
    logError(CAT, "Failed to read ADC file:", err.message);
    return null;
  }
}

/** Exchange ADC refresh_token for a fresh access_token */
async function getAccessTokenFromADC(adc) {
  log(CAT, "Exchanging ADC refresh_token for access_token...");
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: adc.client_id,
      client_secret: adc.client_secret,
      refresh_token: adc.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    logError(CAT, "ADC token exchange failed:", errText);
    throw new Error(`Token exchange failed: ${errText}`);
  }

  const data = await res.json();
  log(CAT, "ADC access_token obtained, expires_in:", data.expires_in);
  return {
    access_token: data.access_token,
    expiry_date: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}

/** Run gcloud auth application-default login with SSE progress streaming */
function runGcloudAuth(gcloudPath, sendEvent) {
  return new Promise((resolve, reject) => {
    log(CAT, "Starting gcloud auth application-default login...");
    sendEvent("progress", "Opening browser for Google authentication...");

    const child = spawn(
      gcloudPath,
      [
        "auth", "application-default", "login",
        "--scopes", CALENDAR_SCOPE,
        "--no-launch-browser",
      ],
      {
        timeout: 300000, // 5 min for user to complete browser flow
        env: { ...process.env },
      }
    );

    let allOutput = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      allOutput += text;
      const lines = text.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        log(CAT, "[gcloud stdout]", line);

        // Detect the auth URL
        const urlMatch = line.match(/(https:\/\/accounts\.google\.com\S+)/);
        if (urlMatch) {
          sendEvent("auth_url", urlMatch[1]);
          sendEvent("progress", "Please complete authentication in your browser.");
        } else {
          sendEvent("progress", line);
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      allOutput += text;
      const lines = text.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        log(CAT, "[gcloud stderr]", line);

        const urlMatch = line.match(/(https:\/\/accounts\.google\.com\S+)/);
        if (urlMatch) {
          sendEvent("auth_url", urlMatch[1]);
          sendEvent("progress", "Please complete authentication in your browser.");
        } else {
          sendEvent("progress", line);
        }
      }
    });

    child.on("close", (code) => {
      log(CAT, `gcloud auth exited with code ${code}`);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`gcloud auth failed (exit code ${code})`));
      }
    });

    child.on("error", (err) => {
      logError(CAT, "gcloud auth spawn error:", err.message);
      reject(err);
    });
  });
}

// ── Direct OAuth flow (no CLI dependency) ─────────────────────────────────────

const OAUTH_SUCCESS_HTML = `<!DOCTYPE html><html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f1117;color:#e8e8e8">
<div style="text-align:center"><h2>Google Calendar Connected</h2><p>You can close this tab and return to Open Canvas.</p></div></body></html>`;

const OAUTH_ERROR_HTML = (msg) => `<!DOCTYPE html><html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f1117;color:#e8e8e8">
<div style="text-align:center"><h2>Connection Failed</h2><p>${msg}</p></div></body></html>`;

/**
 * Run the direct OAuth2 flow:
 *  1. Start a temp HTTP server on a random port
 *  2. Open browser to Google consent screen
 *  3. Google redirects to localhost:{port}/oauth/callback?code=...
 *  4. Exchange code for tokens
 *  5. Shut down temp server
 */
function runDirectOAuth(provider, clientId, clientSecret, sendEvent) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url, `http://localhost`);

      if (reqUrl.pathname !== "/oauth/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = reqUrl.searchParams.get("code");
      const error = reqUrl.searchParams.get("error");

      if (error) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(OAUTH_ERROR_HTML(`Google returned: ${error}`));
        server.close();
        reject(new Error(`OAuth denied: ${error}`));
        return;
      }

      if (!code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(OAUTH_ERROR_HTML("No authorization code received"));
        server.close();
        reject(new Error("No authorization code received"));
        return;
      }

      sendEvent("progress", "Authorization received, exchanging for tokens...");

      try {
        const redirectUri = `http://localhost:${server.address().port}/oauth/callback`;
        const tokens = await provider.exchangeCode(code, clientId, clientSecret, redirectUri);

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(OAUTH_SUCCESS_HTML);
        server.close();
        resolve(tokens);
      } catch (err) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(OAUTH_ERROR_HTML(err.message));
        server.close();
        reject(err);
      }
    });

    // Listen on random port
    server.listen(0, () => {
      const port = server.address().port;
      const authUrl = provider.getAuthUrl(clientId, clientSecret, port);
      log(CAT, `Direct OAuth callback server listening on port ${port}`);
      sendEvent("progress", "Opening browser for Google authentication...");
      sendEvent("auth_url", authUrl);
    });

    // Timeout after 5 minutes
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("OAuth flow timed out (5 minutes). Please try again."));
    }, 5 * 60 * 1000);

    server.on("close", () => clearTimeout(timeout));
  });
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function handle(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;

  // ── GET /api/calendar/connections ──────────────────────────────────────
  if (pathname === "/api/calendar/connections" && method === "GET") {
    log(CAT, "Listing calendar connections");
    const connections = listConnections();
    const safe = connections.map((c) => ({
      ...c,
      credentials: {
        has_access_token: !!c.credentials.access_token,
        has_refresh_token: !!c.credentials.refresh_token,
        token_expiry: c.credentials.token_expiry,
        auth_method: c.credentials.auth_method || "manual",
      },
    }));
    jsonResponse(res, { connections: safe, providers: listProviders().map((p) => ({ id: p.id, name: p.name })) });
    return true;
  }

  // ── GET /api/calendar/gcloud-status ───────────────────────────────────
  if (pathname === "/api/calendar/gcloud-status" && method === "GET") {
    log(CAT, "Checking gcloud status");
    const gcloudPath = await checkGcloud();
    const adc = readADC();
    const hasValidADC = !!(adc && adc.client_id && adc.refresh_token);
    const globalConfig = readGlobalConfig();
    const hasClientCreds = !!(
      globalConfig.api_keys?.google_calendar_client_id &&
      globalConfig.api_keys?.google_calendar_client_secret
    );

    jsonResponse(res, {
      directOAuthAvailable: hasClientCreds,
      gcloudInstalled: !!gcloudPath,
      hasADC: hasValidADC,
      adcPath: ADC_PATH,
      method: hasClientCreds ? "direct" : (!!gcloudPath ? "gcloud" : "none"),
    });
    return true;
  }

  // ── POST /api/calendar/connections ─────────────────────────────────────
  if (pathname === "/api/calendar/connections" && method === "POST") {
    const body = await parseBody(req);

    // ── Initiate OAuth flow (direct first, gcloud fallback) ──────────────
    if (body.action === "initiate-oauth") {
      const providerId = body.provider;
      if (!providerId) {
        jsonResponse(res, { error: "provider required" }, 400);
        return true;
      }

      // Switch to SSE streaming
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const sendEvent = (type, data) => {
        try {
          res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
        } catch {}
      };

      // Check for client ID/secret in API keys (direct OAuth)
      const globalConfig = readGlobalConfig();
      const clientId = globalConfig.api_keys?.google_calendar_client_id;
      const clientSecret = globalConfig.api_keys?.google_calendar_client_secret;

      // ── Method 1: Direct OAuth (preferred) ────────────────────────────
      if (clientId && clientSecret) {
        log(CAT, "Using direct OAuth flow (client credentials configured)");
        sendEvent("progress", "Starting Google Calendar authentication...");

        const provider = getProvider(providerId);
        if (!provider) {
          sendEvent("error", "Unknown calendar provider");
          res.end();
          return true;
        }

        try {
          const tokens = await runDirectOAuth(provider, clientId, clientSecret, sendEvent);

          log(CAT, "Direct OAuth complete, creating connection");
          const connection = addConnection(providerId, {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            token_expiry: tokens.expiry_date,
            client_id: clientId,
            client_secret: clientSecret,
            auth_method: "direct-oauth",
          });

          sendEvent("progress", "Google Calendar connected successfully!");
          log(CAT, "Connection created:", connection.id);
          sendEvent("done", { success: true, connectionId: connection.id });
          res.end();
        } catch (err) {
          logError(CAT, "Direct OAuth failed:", err.message);
          sendEvent("error", err.message);
          res.end();
        }
        return true;
      }

      // ── Method 2: gcloud CLI fallback ─────────────────────────────────
      log(CAT, "No client credentials configured, falling back to gcloud CLI");
      sendEvent("progress", "No API keys configured. Trying gcloud CLI fallback...");

      try {
        sendEvent("progress", "Checking for Google Cloud SDK...");
        let gcloudPath = await checkGcloud();

        if (!gcloudPath) {
          sendEvent("progress", "Google Cloud SDK not found. Installing...");
          log(CAT, "gcloud not found, attempting install");

          const brewInstalled = await new Promise((resolve) => {
            execFile("which", ["brew"], (err) => resolve(!err));
          });

          if (!brewInstalled) {
            logError(CAT, "No OAuth method available");
            sendEvent("error", "No connection method available. Either add google_calendar_client_id and google_calendar_client_secret in Settings > API Keys, or install the Google Cloud SDK manually: https://cloud.google.com/sdk/docs/install");
            res.end();
            return true;
          }

          try {
            gcloudPath = await installGcloud(sendEvent);
          } catch (installErr) {
            sendEvent("error", `gcloud install failed: ${installErr.message}. Add google_calendar_client_id and google_calendar_client_secret in Settings > API Keys instead.`);
            res.end();
            return true;
          }
        }

        sendEvent("progress", "Google Cloud SDK is ready.");
        log(CAT, "gcloud ready at:", gcloudPath);

        try {
          await runGcloudAuth(gcloudPath, sendEvent);
        } catch (authErr) {
          logError(CAT, "gcloud auth failed:", authErr.message);
          sendEvent("error", authErr.message);
          res.end();
          return true;
        }

        sendEvent("progress", "Reading credentials...");
        const adc = readADC();
        if (!adc || !adc.refresh_token) {
          logError(CAT, "ADC file missing or incomplete after auth");
          sendEvent("error", "Authentication completed but credentials file is missing or incomplete. Try again.");
          res.end();
          return true;
        }

        sendEvent("progress", "Obtaining access token...");
        let tokenData;
        try {
          tokenData = await getAccessTokenFromADC(adc);
        } catch (tokenErr) {
          sendEvent("error", `Failed to obtain access token: ${tokenErr.message}`);
          res.end();
          return true;
        }

        log(CAT, "Creating calendar connection with ADC credentials");
        const connection = addConnection(providerId, {
          access_token: tokenData.access_token,
          refresh_token: adc.refresh_token,
          token_expiry: tokenData.expiry_date,
          client_id: adc.client_id,
          client_secret: adc.client_secret,
          auth_method: "gcloud-adc",
        });

        sendEvent("progress", "Google Calendar connected successfully!");
        log(CAT, "Connection created:", connection.id);
        sendEvent("done", { success: true, connectionId: connection.id });
        res.end();
      } catch (err) {
        logError(CAT, "Unexpected error in OAuth flow:", err.message);
        sendEvent("error", err.message);
        res.end();
      }
      return true;
    }

    // List available calendars for a connection
    if (body.action === "list-calendars") {
      log(CAT, "Listing calendars for connection:", body.connectionId);
      const conn = getConnection(body.connectionId);
      if (!conn) {
        jsonResponse(res, { error: "Connection not found" }, 404);
        return true;
      }

      const provider = getProvider(conn.provider);
      if (!provider) {
        jsonResponse(res, { error: "Provider not found" }, 400);
        return true;
      }

      try {
        const calendars = await provider.listCalendars(conn.credentials.access_token);
        log(CAT, "Found calendars:", calendars.length);
        jsonResponse(res, { calendars });
      } catch (err) {
        logError(CAT, "List calendars error:", err.message);
        jsonResponse(res, { error: err.message }, 500);
      }
      return true;
    }

    // Update connection settings
    if (body.action === "update") {
      if (!body.connectionId) {
        jsonResponse(res, { error: "connectionId required" }, 400);
        return true;
      }
      log(CAT, "Updating connection:", body.connectionId);
      const updated = updateConnection(body.connectionId, body.updates || {});
      if (!updated) {
        jsonResponse(res, { error: "Connection not found" }, 404);
        return true;
      }
      jsonResponse(res, { connection: updated });
      return true;
    }

    // Remove connection
    if (body.action === "remove") {
      if (!body.connectionId) {
        jsonResponse(res, { error: "connectionId required" }, 400);
        return true;
      }
      log(CAT, "Removing connection:", body.connectionId);
      const removed = removeConnection(body.connectionId);
      jsonResponse(res, { removed });
      return true;
    }

    // Test connection
    if (body.action === "test") {
      log(CAT, "Testing connection:", body.connectionId);
      const conn = getConnection(body.connectionId);
      if (!conn) {
        jsonResponse(res, { error: "Connection not found" }, 404);
        return true;
      }

      const provider = getProvider(conn.provider);
      if (!provider) {
        jsonResponse(res, { error: "Provider not found" }, 400);
        return true;
      }

      try {
        const calendars = await provider.listCalendars(conn.credentials.access_token);
        log(CAT, "Connection test passed, calendars:", calendars.length);
        jsonResponse(res, { ok: true, calendars: calendars.length });
      } catch (err) {
        logError(CAT, "Connection test failed:", err.message);
        jsonResponse(res, { ok: false, error: err.message });
      }
      return true;
    }

    jsonResponse(res, { error: "action required" }, 400);
    return true;
  }

  // ── POST /api/calendar/sync ────────────────────────────────────────────
  if (pathname === "/api/calendar/sync" && method === "POST") {
    const body = await parseBody(req);

    if (body.action === "sync") {
      if (!body.connectionId) {
        log(CAT, "Syncing all enabled connections");
        const connections = listConnections().filter((c) => c.enabled);
        const reports = [];
        for (const conn of connections) {
          try {
            log(CAT, "Syncing connection:", conn.id);
            const report = await syncConnection(conn.id);
            log(CAT, "Sync complete:", { pulled: report.pulled, pushed: report.pushed, errors: report.errors.length });
            reports.push(report);
          } catch (err) {
            logError(CAT, "Sync error for", conn.id, ":", err.message);
            reports.push({ connectionId: conn.id, errors: [err.message] });
          }
        }
        jsonResponse(res, { reports });
        return true;
      }

      try {
        log(CAT, "Syncing connection:", body.connectionId);
        const report = await syncConnection(body.connectionId);
        log(CAT, "Sync complete:", { pulled: report.pulled, pushed: report.pushed, errors: report.errors.length });
        jsonResponse(res, { report });
      } catch (err) {
        logError(CAT, "Sync error:", err.message);
        jsonResponse(res, { error: err.message }, 500);
      }
      return true;
    }

    if (body.action === "push-event") {
      if (!body.connectionId || !body.eventId) {
        jsonResponse(res, { error: "connectionId and eventId required" }, 400);
        return true;
      }
      try {
        log(CAT, "Pushing event:", body.eventId, "to connection:", body.connectionId);
        await pushEvent(body.connectionId, body.eventId);
        log(CAT, "Event pushed successfully");
        jsonResponse(res, { ok: true });
      } catch (err) {
        logError(CAT, "Push event error:", err.message);
        jsonResponse(res, { error: err.message }, 500);
      }
      return true;
    }

    jsonResponse(res, { error: "action required (sync|push-event)" }, 400);
    return true;
  }

  return false;
}
