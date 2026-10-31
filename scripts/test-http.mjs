import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { api, check, convex, done } from "./lib.mjs";

const PORT = 8797;
const base = `http://127.0.0.1:${PORT}`;
const UI = "http://127.0.0.1:5173";

async function startServer(env = {}) {
  const child = spawn(process.execPath, ["agent/http.ts"], {
    env: { ...process.env, AGENT_PORT: String(PORT), ...env },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("listening")) resolve();
    });
    child.once("exit", (code) => reject(new Error(`agent http exited with ${code}`)));
  });
  return child;
}

async function stopServer(child) {
  child.kill();
  await once(child, "exit");
}

function post(path, body, origin = UI) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function preflight(origin) {
  const res = await fetch(`${base}/run-both`, { method: "OPTIONS", headers: { Origin: origin } });
  return {
    status: res.status,
    allow: res.headers.get("access-control-allow-origin"),
    methods: res.headers.get("access-control-allow-methods"),
  };
}

const seed = async () =>
  (await convex.query(api.inventory.list, {})).map(({ sku, available, pricePerHour, version }) => ({
    sku,
    available,
    pricePerHour,
    version,
  }));

const SEED = [
  { sku: "H100", available: 1, pricePerHour: 5, version: 1 },
  { sku: "A100", available: 2, pricePerHour: 3, version: 1 },
];

const noKey = await startServer({ ANTHROPIC_API_KEY: "" });
try {
  for (const origin of ["http://localhost:5173", "http://127.0.0.1:5173"]) {
    const res = await preflight(origin);
    check(
      `preflight from ${origin} is allowed for POST`,
      res.status === 204 && res.allow === origin && res.methods?.includes("POST"),
      res,
    );
  }
  const foreign = await preflight("http://evil.example");
  check("preflight from another origin does not echo it", foreign.allow === UI, foreign);

  await convex.mutation(api.inventory.resetDemo, {});
  await convex.mutation(api.inventory.externalReprice, { sku: "H100", pricePerHour: 10 });
  for (const path of ["/reset", "/run-both"]) {
    const res = await post(path, undefined, "http://evil.example");
    check(`POST ${path} from another origin returns 403`, res.status === 403, res.status);
  }
  const untouched = (await seed())[0];
  check(
    "cross-site POSTs do not touch the demo",
    untouched.pricePerHour === 10 && untouched.version === 2,
    untouched,
  );
  const noOrigin = await fetch(`${base}/reset`, { method: "POST" });
  check("POST without an Origin header (curl) is allowed", noOrigin.status === 200, noOrigin.status);

  await convex.mutation(api.inventory.externalReprice, { sku: "H100", pricePerHour: 10 });
  await convex.mutation(api.inventory.logEvent, { kind: "READ", detail: "{}", mode: "on" });
  const reset = await post("/reset");
  check(
    "POST /reset returns 200 with the CORS header",
    reset.status === 200 && reset.headers.get("access-control-allow-origin") === UI,
    reset.status,
  );
  const afterReset = await seed();
  check("POST /reset restores the seed", isDeepStrictEqual(afterReset, SEED), afterReset);
  const eventsAfterReset = await convex.query(api.inventory.events, {});
  check("POST /reset clears events", eventsAfterReset.length === 0, eventsAfterReset.length);

  const badMode = await post("/run", { mode: "maybe" });
  check("POST /run with a bad mode returns 400", badMode.status === 400, badMode.status);
  const get = await fetch(`${base}/run-both`);
  check("GET returns 404", get.status === 404, get.status);

  await convex.mutation(api.inventory.externalReprice, { sku: "H100", pricePerHour: 10 });
  const missing = await post("/run-both");
  const body = await missing.json();
  check(
    "POST /run-both without a key returns 500 with the reason",
    missing.status === 500 && body.error === "ANTHROPIC_API_KEY is not set",
    { status: missing.status, body },
  );
  const h100 = (await seed())[0];
  check("missing key does not reset the demo", h100.pricePerHour === 10 && h100.version === 2, h100);
  const resetAfterFail = await post("/reset");
  check("a failed start does not leave the server locked", resetAfterFail.status === 200, resetAfterFail.status);
} finally {
  await stopServer(noKey);
}

async function waitForFinals(runId, timeoutMs = 150_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = (await convex.query(api.inventory.events, {})).filter((row) => row.runId === runId);
    const finals = new Set(rows.filter((row) => row.kind === "FINAL").map((row) => row.mode));
    if (finals.has("on") && finals.has("off")) return rows;
    await sleep(500);
  }
  return null;
}

function receipt(rows, mode) {
  const mine = rows.filter((row) => row.mode === mode);
  const commit = mine.filter((row) => row.kind === "COMMIT").at(-1);
  const paid = commit ? JSON.parse(commit.detail) : null;
  return {
    sku: paid?.sku ?? null,
    pricePerHour: paid?.pricePerHour ?? null,
    overBudget: paid ? paid.pricePerHour > 6 : null,
    stale: mine.filter((row) => row.kind === "STALE").length,
  };
}

if (process.env.LIVE === "1") {
  const live = await startServer();
  try {
    const started = Date.now();
    const first = await post("/run-both");
    const { runId } = await first.json();
    const elapsed = Date.now() - started;
    check(
      "POST /run-both returns 202 with a runId right away",
      first.status === 202 && typeof runId === "string" && elapsed < 5_000,
      { status: first.status, runId, elapsed },
    );

    const second = await post("/run-both");
    check("second POST /run-both while running returns 409", second.status === 409, second.status);
    const resetBusy = await post("/reset");
    check("POST /reset while running returns 409", resetBusy.status === 409, resetBusy.status);

    const rows = await waitForFinals(runId);
    check("run finishes with FINAL in both columns", rows !== null, rows);
    if (rows) {
      const off = receipt(rows, "off");
      const on = receipt(rows, "on");
      console.log(JSON.stringify({ off, on }));
      check(
        "off: H100 $10 OVER BUDGET, no STALE",
        isDeepStrictEqual(off, { sku: "H100", pricePerHour: 10, overBudget: true, stale: 0 }),
        off,
      );
      check(
        "on: A100 $3 within budget after exactly 1 STALE",
        isDeepStrictEqual(on, { sku: "A100", pricePerHour: 3, overBudget: false, stale: 1 }),
        on,
      );
    }

    let resetAfter = 0;
    for (let i = 0; i < 25 && resetAfter !== 200; i++) {
      if (i > 0) await sleep(200);
      resetAfter = (await post("/reset")).status;
    }
    check("lock is released after the run: POST /reset returns 200 within 5s", resetAfter === 200, resetAfter);
  } finally {
    await stopServer(live);
  }
} else {
  console.log("SKIP live /run-both (run `npm run test:live` to include it)");
}

await convex.mutation(api.inventory.resetDemo, {});
done("test:http");
