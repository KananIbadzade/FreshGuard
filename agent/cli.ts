import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { runAgent, type RunResult } from "./run.ts";

const BUDGET = 6;

function receipt(result: RunResult) {
  const last = result.commits.at(-1);
  if (!last) return `${result.mode}: no commit (stale ${result.staleCount})`;
  const verdict = last.pricePerHour > BUDGET ? "OVER BUDGET" : "WITHIN BUDGET";
  return `${result.mode}: ${last.sku} $${last.pricePerHour} ${verdict} (stale ${result.staleCount})`;
}

const mode = process.argv[2];
if (mode !== "on" && mode !== "off") {
  console.error("usage: npm run agent -- on|off");
  process.exit(1);
}

const convexUrl = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;
if (!convexUrl) {
  console.error("CONVEX_URL is not set");
  process.exit(1);
}

await new ConvexHttpClient(convexUrl).mutation(api.inventory.resetDemo, {});
console.log(receipt(await runAgent(mode, crypto.randomUUID())));
