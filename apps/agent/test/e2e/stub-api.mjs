// A stand-in DevGuard API for e2e tests, run as its own process (the tests drive Git with spawnSync, which would
// block an in-process server). Usage: node stub-api.mjs <dir>. Prints the port, then serves until killed.
//   <dir>/down        if this file exists, every request gets a 503
//   <dir>/received    one JSON line per delivered batch: { authorization, body }
//   <dir>/exception.json   if present, the answer to POST /v1/agent/exceptions/validate (default: { valid: false })
//   <dir>/validated   one JSON line per validation request body
import { createServer } from "node:http";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const send = (status, json) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
    };
    if (existsSync(join(dir, "down"))) return send(503, { code: "internal_error", message: "x" });
    if (req.method === "POST" && req.url === "/v1/agent/events") {
      appendFileSync(join(dir, "received"), `${JSON.stringify({ authorization: req.headers.authorization, body })}\n`);
      const events = JSON.parse(body).events;
      return send(200, { results: events.map((e) => ({ idempotencyKey: e.idempotencyKey, status: "accepted" })) });
    }
    if (req.method === "POST" && req.url === "/v1/agent/exceptions/validate") {
      appendFileSync(join(dir, "validated"), `${body}\n`);
      return send(200, existsSync(join(dir, "exception.json")) ? JSON.parse(readFileSync(join(dir, "exception.json"), "utf8")) : { valid: false });
    }
    if (req.method === "POST" && req.url === "/v1/agent/exceptions") {
      const input = JSON.parse(body);
      const destination = new URL(input.destination);
      return send(201, {
        id: "11111111-1111-4111-8111-111111111111",
        projectId: input.projectId,
        projectName: "Portal",
        requesterId: "user-1",
        requesterName: "alice",
        deviceId: null,
        destination: { host: destination.host, repoPath: destination.pathname.slice(1) },
        reason: input.reason,
        status: "pending",
        eventId: null,
        createdAt: "2026-06-01T12:00:00.000Z",
        expiresAt: null,
        decisions: [],
      });
    }
    send(404, { code: "not_found", message: "x" });
  });
});
server.listen(0, "127.0.0.1", () => process.stdout.write(`${server.address().port}\n`));
