import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { runAgent, type RunResult } from "./run.ts";
import { runBoth } from "./runBoth.ts";

const BUDGET = 6;

function receipt(result: RunResult) {
  const last = result.commits.at(-1);
  if (!last) return `${result.mode}: no commit (stale ${result.staleCount})`;
  const verdict = last.pricePerHour > BUDGET ? "OVER BUDGET" : "WITHIN BUDGET";
  return `${result.mode}: ${last.sku} $${last.pricePerHour} ${verdict} (stale ${result.staleCount})`;
}

const mode = process.argv[2];

if (mode === "both") {
  const { off, on } = await runBoth();
  console.log(`${receipt(off)} | ${receipt(on)}`);
} else if (mode === "on" || mode === "off") {
  const convexUrl = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;
  for (const [name, value] of [
    ["ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY],
    ["ANTHROPIC_MODEL", process.env.ANTHROPIC_MODEL],
    ["CONVEX_URL", convexUrl],
  ]) {
    if (!value) {
      console.error(`${name} is not set`);
      process.exit(1);
    }
  }
  await new ConvexHttpClient(convexUrl).mutation(api.inventory.resetDemo, {});
  console.log(receipt(await runAgent(mode, crypto.randomUUID())));
} else {
  console.error("usage: npm run agent -- on|off|both");
  process.exit(1);
}
