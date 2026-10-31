import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { api, check, convex, done } from "./lib.mjs";

if (process.env.LIVE !== "1") {
  console.log("SKIP test:agent (calls Claude; run `npm run test:live` to include it)");
  process.exit(0);
}

const run = promisify(execFile);

async function cli(...args) {
  const { stdout } = await run(process.execPath, ["agent/cli.ts", ...args], {
    env: process.env,
    timeout: 180_000,
  });
  return stdout.trim().split("\n").at(-1);
}

async function agentEvents(mode) {
  const rows = await convex.query(api.inventory.events, {});
  return rows.filter((row) => row.mode === mode);
}

for (const mode of ["on", "off"]) {
  const line = await cli(mode);
  console.log(line);
  check(
    `${mode}: no reprice buys H100 at $5 within budget`,
    line === `${mode}: H100 $5 WITHIN BUDGET (stale 0)`,
    line,
  );
  const rows = await agentEvents(mode);
  const kinds = rows.map((row) => row.kind);
  check(`${mode}: reads inventory exactly once`, kinds.filter((k) => k === "READ").length === 1, kinds);
  check(`${mode}: logs exactly one agent COMMIT`, kinds.filter((k) => k === "COMMIT").length === 1, kinds);
  check(`${mode}: ends with FINAL`, kinds.at(-1) === "FINAL", kinds);
  check(`${mode}: no STALE without a reprice`, !kinds.includes("STALE"), kinds);
}

const BOTH_RUNS = 5;
const expected = "off: H100 $10 OVER BUDGET (stale 0) | on: A100 $3 WITHIN BUDGET (stale 1)";
for (let i = 1; i <= BOTH_RUNS; i++) {
  const line = await cli("both");
  console.log(`both #${i}: ${line}`);
  check(`both #${i}: off pays $10 for H100, on recovers to A100 at $3`, line === expected, line);

  const off = (await agentEvents("off")).map((row) => row.kind);
  const on = (await agentEvents("on")).map((row) => row.kind);
  check(`both #${i}: off reads once and never sees STALE`, off.filter((k) => k === "READ").length === 1 && !off.includes("STALE"), off);
  check(
    `both #${i}: on gets one STALE, then re-reads before committing`,
    on.filter((k) => k === "STALE").length === 1 &&
      on.filter((k) => k === "READ").length === 2 &&
      on.lastIndexOf("READ") > on.indexOf("STALE") &&
      on.indexOf("COMMIT") > on.lastIndexOf("READ"),
    on,
  );
}

await convex.mutation(api.inventory.resetDemo, {});
done("test:agent");
