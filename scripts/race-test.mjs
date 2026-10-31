import { api, attempt, callTool, check, convex, done, withMcp } from "./lib.mjs";

const phaseOnly = process.argv.includes("--phase1");

async function phase1() {
  await convex.mutation(api.inventory.resetDemo, {});
  const attempts = await Promise.all(
    Array.from({ length: 20 }, () =>
      attempt(convex.mutation(api.inventory.reserveGuarded, { sku: "A100", expectedVersion: 1 })),
    ),
  );

  const successes = attempts.filter((row) => row.ok);
  const stales = attempts.filter((row) => !row.ok && row.data?.code === "STALE_DEPENDENCY");
  const other = attempts.filter((row) => !row.ok && row.data?.code !== "STALE_DEPENDENCY");
  const items = await convex.query(api.inventory.list, {});
  const negative = items.some((item) => item.available < 0);
  const a100 = items.find((item) => item.sku === "A100");

  console.log("PHASE 1");
  console.log(
    JSON.stringify(
      {
        successes: successes.length,
        stale: stales.length,
        other: other.length,
        negative,
        a100: a100 ? { available: a100.available, version: a100.version } : null,
        sampleStale: stales[0]?.data ?? null,
      },
      null,
      2,
    ),
  );

  check("exactly 1 of 20 parallel guarded reserves commits", successes.length === 1, successes.length);
  check("exactly 19 get STALE_DEPENDENCY", stales.length === 19, stales.length);
  check("no other errors", other.length === 0, other);
  check("inventory never negative", !negative, items);
  check(
    "A100 ends at 1 unit, v2",
    a100?.available === 1 && a100?.version === 2,
    a100 && { available: a100.available, version: a100.version },
  );
}

function choose(items) {
  return (
    items
      .filter((item) => item.available >= 1 && item.pricePerHour <= 6)
      .sort((a, b) => b.pricePerHour - a.pricePerHour)[0] ?? null
  );
}

async function scenario(client, mode) {
  await convex.mutation(api.inventory.resetDemo, {});
  const trace = [];
  const first = await callTool(client, "read_inventory", {});
  trace.push({ step: "read", body: first.body });
  let items = first.body?.items ?? [];

  await convex.mutation(api.inventory.externalReprice, { sku: "H100", pricePerHour: 10 });
  trace.push({ step: "reprice", sku: "H100", pricePerHour: 10 });

  let outcome = null;
  for (let round = 1; round <= 3; round++) {
    const pick = choose(items);
    trace.push({
      step: "plan",
      round,
      sku: pick?.sku ?? null,
      pricePerHour: pick?.pricePerHour ?? null,
      version: pick?.version ?? null,
    });
    if (!pick) break;
    const args = mode === "on" ? { sku: pick.sku, expectedVersion: pick.version } : { sku: pick.sku };
    const reserved = await callTool(client, "reserve_inventory", args);
    trace.push({ step: "reserve", round, isError: reserved.isError, body: reserved.body });
    if (!reserved.isError && reserved.body?.success) {
      outcome = {
        sku: reserved.body.sku,
        pricePerHour: reserved.body.pricePerHour,
        overBudget: reserved.body.pricePerHour > 6,
      };
      break;
    }
    if (reserved.body?.code !== "STALE_DEPENDENCY") break;
    const again = await callTool(client, "read_inventory", {});
    items = again.body?.items ?? [];
    trace.push({ step: "reread", body: again.body });
  }
  return { outcome, trace };
}

async function phase2() {
  const summary = {};
  for (const mode of ["on", "off"]) {
    const runs = [];
    await withMcp(mode, async (client) => {
      for (let i = 0; i < 10; i++) runs.push(await scenario(client, mode));
    });
    summary[mode] = {
      runs: runs.length,
      overBudget: runs.filter((run) => run.outcome?.overBudget).length,
      outcomes: runs.map((run) => run.outcome),
    };
    console.log(`PHASE 2 sample trace FRESHGUARD=${mode}`);
    console.log(JSON.stringify(runs[0].trace));
  }

  console.log("PHASE 2");
  console.log(JSON.stringify(summary, null, 2));

  const all = (mode, sku, price) =>
    summary[mode].outcomes.every((o) => o?.sku === sku && o?.pricePerHour === price);
  check("guarded: 0/10 over budget", summary.on.overBudget === 0, summary.on.overBudget);
  check("guarded: every outcome is A100 at $3", all("on", "A100", 3), summary.on.outcomes);
  check("unguarded: 10/10 over budget", summary.off.overBudget === 10, summary.off.overBudget);
  check("unguarded: every outcome is H100 at $10", all("off", "H100", 10), summary.off.outcomes);
}

await phase1();
if (!phaseOnly) await phase2();
await convex.mutation(api.inventory.resetDemo, {});
done("test:race");
