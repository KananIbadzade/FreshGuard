import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { runAgent, type RunResult } from "./run.ts";

const BARRIER_TIMEOUT_MS = 90_000;

export type BothResult = { runId: string; off: RunResult; on: RunResult };

// Validates env and resets before returning, so a missing key never wipes the demo.
export async function startBoth(): Promise<{ runId: string; done: Promise<BothResult> }> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  if (!process.env.ANTHROPIC_MODEL) throw new Error("ANTHROPIC_MODEL is not set");
  const convexUrl = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;
  if (!convexUrl) throw new Error("CONVEX_URL is not set");

  const convex = new ConvexHttpClient(convexUrl);
  const runId = crypto.randomUUID();
  await convex.mutation(api.inventory.resetDemo, {});

  let reads = 0;
  let repriced = false;
  let release: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });

  // Each agent pauses here with its first snapshot (H100 $5 v1) still unseen by the model.
  // The count must increase before any await so both arrivals cannot both see 1.
  const afterFirstRead = async () => {
    reads += 1;
    if (reads >= 2 && !repriced) {
      repriced = true;
      await convex.mutation(api.inventory.externalReprice, { sku: "H100", pricePerHour: 10 });
      release();
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("timed out waiting for both agents to finish their first read")),
        BARRIER_TIMEOUT_MS,
      );
    });
    try {
      await Promise.race([opened, timeout]);
    } finally {
      clearTimeout(timer);
    }
  };

  const done = Promise.all([
    runAgent("off", runId, { afterFirstRead }),
    runAgent("on", runId, { afterFirstRead }),
  ]).then(([off, on]) => ({ runId, off, on }));
  return { runId, done };
}

export async function runBoth(): Promise<BothResult> {
  const { done } = await startBoth();
  return done;
}
