import http from "node:http";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { runAgent, type Mode } from "./run.ts";
import { startBoth } from "./runBoth.ts";

const port = Number(process.env.AGENT_PORT ?? 8787);
const ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

const convexUrl = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;
if (!convexUrl) {
  console.error("CONVEX_URL is not set");
  process.exit(1);
}
const convex = new ConvexHttpClient(convexUrl);

// One run at a time. Set before any await so two clicks cannot both get through.
let busy = false;

function allowOrigin(req: http.IncomingMessage) {
  const origin = req.headers.origin;
  return origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[1];
}

function corsHeaders(req: http.IncomingMessage) {
  return {
    "Access-Control-Allow-Origin": allowOrigin(req),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function send(req: http.IncomingMessage, res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", ...corsHeaders(req) });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function messageOf(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

// Runs in the background and holds the lock until `done` settles.
// A failure is logged as FINAL in each of `failModes` so the UI is not left waiting.
function watch(runId: string, done: Promise<unknown>, failModes: Mode[]) {
  done
    .catch(async (err) => {
      console.error(`run ${runId} failed:`, err);
      for (const mode of failModes) {
        await convex
          .mutation(api.inventory.logEvent, { kind: "FINAL", detail: `run failed: ${messageOf(err)}`, mode, runId })
          .catch(() => {});
      }
    })
    .finally(() => {
      busy = false;
    });
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.url === "/reset") {
    if (busy) return send(req, res, 409, { error: "a run is in progress" });
    await convex.mutation(api.inventory.resetDemo, {});
    return send(req, res, 200, { ok: true });
  }

  if (req.url === "/run-both") {
    if (busy) return send(req, res, 409, { error: "a run is in progress" });
    busy = true;
    try {
      const { runId, done } = await startBoth();
      // startBoth logs FINAL for whichever agent failed.
      watch(runId, done, []);
      return send(req, res, 202, { runId });
    } catch (err) {
      busy = false;
      throw err;
    }
  }

  if (req.url === "/run") {
    const raw = await readBody(req);
    const body = raw ? (JSON.parse(raw) as { mode?: Mode }) : {};
    if (body.mode !== "on" && body.mode !== "off") {
      return send(req, res, 400, { error: "mode must be on or off" });
    }
    if (busy) return send(req, res, 409, { error: "a run is in progress" });
    busy = true;
    const runId = crypto.randomUUID();
    watch(runId, runAgent(body.mode, runId), [body.mode]);
    return send(req, res, 202, { runId });
  }

  send(req, res, 404, { error: "not found" });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }
  if (req.method !== "POST") {
    send(req, res, 404, { error: "not found" });
    return;
  }
  try {
    await handle(req, res);
  } catch (err) {
    send(req, res, 500, { error: messageOf(err) });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`agent http listening on http://127.0.0.1:${port}`);
});
