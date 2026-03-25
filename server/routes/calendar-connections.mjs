// server/routes/calendar-connections.mjs — Calendar connection & sync API routes

import http from "http";
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

// Track active OAuth listeners
const activeOAuthListeners = new Map();

function startOAuthListener(connectionId, provider, clientId, clientSecret) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost`);
      if (url.pathname === "/oauth/callback") {
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<html><body><h2>Authorization failed</h2><p>You can close this window.</p></body></html>");
          server.close();
          activeOAuthListeners.delete(connectionId);
          reject(new Error(error));
          return;
        }

        if (code) {
          try {
            const port = server.address().port;
            const tokens = await provider.exchangeCode(
              code,
              clientId,
              clientSecret,
              `http://localhost:${port}/oauth/callback`
            );

            // Update the connection with tokens
            updateConnection(connectionId, {
              credentials: {
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                token_expiry: tokens.expiry_date,
                client_id: clientId,
                client_secret: clientSecret,
              },
            });

            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(
              "<html><body style='font-family:system-ui;text-align:center;padding:40px'>" +
              "<h2 style='color:#22c55e'>Connected!</h2>" +
              "<p>Google Calendar connected to Open Canvas. You can close this window.</p>" +
              "</body></html>"
            );

            server.close();
            activeOAuthListeners.delete(connectionId);
            resolve(tokens);
          } catch (err) {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end("<html><body><h2>Token exchange failed</h2><p>" + err.message + "</p></body></html>");
            server.close();
            activeOAuthListeners.delete(connectionId);
            reject(err);
          }
        }
      }
    });

    // Listen on random port
    server.listen(0, "127.0.0.1", () => {
      activeOAuthListeners.set(connectionId, server);
      // Auto-close after 5 minutes
      setTimeout(() => {
        if (activeOAuthListeners.has(connectionId)) {
          server.close();
          activeOAuthListeners.delete(connectionId);
        }
      }, 5 * 60 * 1000);
    });

    server.on("error", reject);

    // Return the port via a callback
    server.once("listening", () => {
      const port = server.address().port;
      resolve({ port, server });
    });
  });
}

export async function handle(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;

  // ── GET /api/calendar/connections ──────────────────────────────────────
  if (pathname === "/api/calendar/connections" && method === "GET") {
    const connections = listConnections();
    // Mask sensitive credentials
    const safe = connections.map((c) => ({
      ...c,
      credentials: {
        has_access_token: !!c.credentials.access_token,
        has_refresh_token: !!c.credentials.refresh_token,
        token_expiry: c.credentials.token_expiry,
      },
    }));
    jsonResponse(res, { connections: safe, providers: listProviders().map((p) => ({ id: p.id, name: p.name })) });
    return true;
  }

  // ── POST /api/calendar/connections ─────────────────────────────────────
  if (pathname === "/api/calendar/connections" && method === "POST") {
    const body = await parseBody(req);

    // Initiate OAuth flow
    if (body.action === "initiate-oauth") {
      const providerId = body.provider;
      if (!providerId) {
        jsonResponse(res, { error: "provider required" }, 400);
        return true;
      }

      const provider = getProvider(providerId);
      if (!provider) {
        jsonResponse(res, { error: `Provider ${providerId} not found` }, 400);
        return true;
      }

      // Read API keys from global config
      const globalConfig = readGlobalConfig();
      const clientId = globalConfig.api_keys?.google_calendar_client_id;
      const clientSecret = globalConfig.api_keys?.google_calendar_client_secret;

      if (!clientId || !clientSecret) {
        jsonResponse(res, {
          error: "Google Calendar credentials not configured",
          hint: "Add google_calendar_client_id and google_calendar_client_secret in Settings > API Keys",
        }, 400);
        return true;
      }

      // Create a pending connection
      const connection = addConnection(providerId, {
        client_id: clientId,
        client_secret: clientSecret,
      });

      try {
        // Start OAuth listener
        const { port } = await startOAuthListener(connection.id, provider, clientId, clientSecret);
        const authUrl = provider.getAuthUrl(clientId, clientSecret, port);

        jsonResponse(res, {
          connectionId: connection.id,
          authUrl,
          message: "Open the authUrl in your browser to authorize",
        });
      } catch (err) {
        removeConnection(connection.id);
        jsonResponse(res, { error: err.message }, 500);
      }
      return true;
    }

    // List available calendars for a connection
    if (body.action === "list-calendars") {
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
        jsonResponse(res, { calendars });
      } catch (err) {
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
      const removed = removeConnection(body.connectionId);
      jsonResponse(res, { removed });
      return true;
    }

    // Test connection
    if (body.action === "test") {
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
        jsonResponse(res, { ok: true, calendars: calendars.length });
      } catch (err) {
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
        // Sync all enabled connections
        const connections = listConnections().filter((c) => c.enabled);
        const reports = [];
        for (const conn of connections) {
          try {
            const report = await syncConnection(conn.id);
            reports.push(report);
          } catch (err) {
            reports.push({ connectionId: conn.id, errors: [err.message] });
          }
        }
        jsonResponse(res, { reports });
        return true;
      }

      try {
        const report = await syncConnection(body.connectionId);
        jsonResponse(res, { report });
      } catch (err) {
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
        await pushEvent(body.connectionId, body.eventId);
        jsonResponse(res, { ok: true });
      } catch (err) {
        jsonResponse(res, { error: err.message }, 500);
      }
      return true;
    }

    jsonResponse(res, { error: "action required (sync|push-event)" }, 400);
    return true;
  }

  return false;
}
