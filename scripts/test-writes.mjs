import { isDeepStrictEqual } from "node:util";
import { api, attempt, check, convex, done } from "./lib.mjs";

const pick = (row) =>
  row && { available: row.available, pricePerHour: row.pricePerHour, version: row.version };

async function h100() {
  const items = await convex.query(api.inventory.list, {});
  return pick(items.find((item) => item.sku === "H100"));
}

await convex.mutation(api.inventory.resetDemo, {});
const seed = (await convex.query(api.inventory.list, {})).map((item) => ({
  sku: item.sku,
  ...pick(item),
}));
check(
  "reset seeds H100 1/$5/v1 then A100 2/$3/v1",
  isDeepStrictEqual(seed, [
    { sku: "H100", available: 1, pricePerHour: 5, version: 1 },
    { sku: "A100", available: 2, pricePerHour: 3, version: 1 },
  ]),
  seed,
);

const repriced = await convex.mutation(api.inventory.externalReprice, {
  sku: "H100",
  pricePerHour: 10,
});
check(
  "reprice H100 -> $10 bumps version to 2",
  isDeepStrictEqual(repriced, { sku: "H100", pricePerHour: 10, version: 2 }),
  repriced,
);

const guarded = await attempt(
  convex.mutation(api.inventory.reserveGuarded, { sku: "H100", expectedVersion: 1 }),
);
check("guarded reserve at stale v1 is rejected", !guarded.ok, guarded);
check(
  "rejection payload is exact STALE_DEPENDENCY",
  isDeepStrictEqual(guarded.data, {
    code: "STALE_DEPENDENCY",
    sku: "H100",
    observedVersion: 1,
    currentVersion: 2,
    requiredAction: "READ_AND_REPLAN",
  }),
  guarded.data,
);

const afterReject = await h100();
check(
  "rejected write leaves H100 at 1/$10/v2",
  isDeepStrictEqual(afterReject, { available: 1, pricePerHour: 10, version: 2 }),
  afterReject,
);
const commitsAfterReject = (await convex.query(api.inventory.events, {})).filter(
  (row) => row.kind === "COMMIT",
);
check("rejected write logs no COMMIT", commitsAfterReject.length === 0, commitsAfterReject);

const unguarded = await attempt(convex.mutation(api.inventory.reserveUnguarded, { sku: "H100" }));
check(
  "unguarded reserve commits H100 at $10, v3",
  unguarded.ok &&
    isDeepStrictEqual(unguarded.value, {
      success: true,
      sku: "H100",
      pricePerHour: 10,
      available: 0,
      version: 3,
    }),
  unguarded,
);

const soldOut = await attempt(convex.mutation(api.inventory.reserveUnguarded, { sku: "H100" }));
check(
  "unguarded reserve on empty stock throws INSUFFICIENT_INVENTORY",
  !soldOut.ok && soldOut.data?.code === "INSUFFICIENT_INVENTORY",
  soldOut,
);
const afterSoldOut = await h100();
check(
  "stock never goes negative",
  isDeepStrictEqual(afterSoldOut, { available: 0, pricePerHour: 10, version: 3 }),
  afterSoldOut,
);

await convex.mutation(api.inventory.logEvent, {
  kind: "STALE",
  sku: "H100",
  mode: "on",
  runId: "test-writes",
  detail: JSON.stringify(guarded.data),
});
const logged = (await convex.query(api.inventory.events, {})).find(
  (row) => row.runId === "test-writes",
);
check(
  "logEvent inserts an event with mode and runId",
  logged?.kind === "STALE" && logged?.mode === "on",
  logged,
);

await convex.mutation(api.inventory.resetDemo, {});
done("test:writes");
