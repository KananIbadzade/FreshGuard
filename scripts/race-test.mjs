import { api, attempt, check, convex, done } from "./lib.mjs";

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

await phase1();
await convex.mutation(api.inventory.resetDemo, {});
done("test:race");
