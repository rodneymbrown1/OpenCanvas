import { generateContextHandoff } from "../../src/lib/contextSharing.js";

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

export function handle(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;

  if (pathname !== "/api/context-handoff") return false;

  if (method === "POST") {
    (async () => {
      try {
        const { workDir, fromAgent, toAgent, fromSessionId } =
          await parseBody(req);

        if (!workDir || !fromAgent || !toAgent) {
          json(
            res,
            { error: "workDir, fromAgent, and toAgent are required" },
            400
          );
          return;
        }

        const handoffPath = await generateContextHandoff(
          workDir,
          fromAgent,
          toAgent,
          fromSessionId
        );

        json(res, { ok: true, path: handoffPath });
      } catch (err) {
        json(
          res,
          { error: `Failed to generate handoff: ${err}` },
          500
        );
      }
    })();
    return true;
  }

  return false;
}
