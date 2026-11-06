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
  let released = false;
  let release: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });

  // Each agent pauses here with its first snapshot (H100 $5 v1) still unseen by the model.
  // The count must increase before any await so both arrivals cannot both see 1.
  // Reprice waits until after the think pause (see afterThink) so a click can land first.
  const afterFirstRead = async () => {
    reads += 1;
    if (reads >= 2 && !released) {
      released = true;
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

  // One reprice for the pair, after both agents have shown Thinking….
  // If the operator already moved H100 off the seed during that pause, keep their edit.
  let repriceOnce: Promise<void> | undefined;
  const afterThink = () => {
    repriceOnce ??= (async () => {
      const items = await convex.query(api.inventory.list, {});
      const h100 = items.find((item) => item.sku === "H100");
      if (!h100 || h100.version !== 1 || h100.pricePerHour !== 5) return;
      await convex.mutation(api.inventory.externalReprice, { sku: "H100", pricePerHour: 10 });
    })();
    return repriceOnce;
  };

  // allSettled, not all: a failed agent must not release the caller while the other one can still write.
  const done = Promise.allSettled([
    runAgent("off", runId, { afterFirstRead, afterThink }),
    runAgent("on", runId, { afterFirstRead, afterThink }),
  ]).then(async ([off, on]) => {
    const settled = [
      ["off", off],
      ["on", on],
    ] as const;
    for (const [mode, result] of settled) {
      if (result.status === "rejected") {
        const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
        await convex
          .mutation(api.inventory.logEvent, { kind: "FINAL", detail: `run failed: ${message}`, mode, runId })
          .catch(() => {});
      }
    }
    if (off.status === "rejected") throw off.reason;
    if (on.status === "rejected") throw on.reason;
    return { runId, off: off.value, on: on.value };
  });
  return { runId, done };
}

export async function runBoth(): Promise<BothResult> {
  const { done } = await startBoth();
  return done;
}
