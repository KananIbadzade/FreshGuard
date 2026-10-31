# FreshGuard — Convex Implementation

## How Convex Transactions Actually Work

Sources:
- OCC and Atomicity: [https://docs.convex.dev/database/advanced/occ](https://docs.convex.dev/database/advanced/occ)
- Application errors: [https://docs.convex.dev/functions/error-handling/application-errors](https://docs.convex.dev/functions/error-handling/application-errors)
- Mutations: [https://docs.convex.dev/functions/mutation-functions](https://docs.convex.dev/functions/mutation-functions)

- **Every mutation runs as one serializable transaction.** All reads inside see a consistent view; all writes commit together or not at all. If a mutation throws, nothing is written.
- **OCC (optimistic concurrency control):** Convex treats a transaction as a *declarative proposal* — writes commit only if every record version in the transaction's read set is still the latest. On conflict, Convex can transparently re-run the deterministic transaction until it succeeds ("will always eventually succeed without developer intervention"). The guarantee is **true serializability**, not just snapshot isolation.
- **`ConvexError`:** throwing it in a mutation **prevents the transaction from committing**, and any structured payload passed to the constructor is preserved on `error.data` for the caller.
- **Constraint:** mutations must be deterministic and cannot call third-party APIs — external side effects belong in *actions*.

## The Key Design Point (know this for judge questions)

Convex's internal OCC makes each mutation serializable; it does not validate an observation obtained in an earlier tool call. FreshGuard carries that earlier observation's version into the mutation as a fixed precondition — an explicit argument that remains unchanged across any internal transaction retries. A mismatch throws a `ConvexError`, which aborts the transaction; no retry can paper over it because the check is deterministic application logic, not a read-set conflict.

**Execution trace to be able to recite:**

```text
Agent observes gpu_A @ version 7
Another mutation reserves gpu_A → version 8
Agent submits reserve(gpu_A, expectedVersion=7)
Mutation reads current version (8) → 7 !== 8 → throw STALE_DEPENDENCY
Transaction aborts; nothing written; agent receives structured error → refreshes → replans
```

Two concurrent reservations carrying version 7: at most one commits; the other receives the structured stale error.

## The Code

The code below is an **illustrative starting point** — it requires the corresponding schema (a `resources` table with a `version` field) and Convex's generated types.

```ts
// convex/resources.ts
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";

export const reserveResource = mutation({
  args: {
    resourceId: v.id("resources"),
    expectedVersion: v.number(), // the version the agent OBSERVED
  },
  handler: async (ctx, { resourceId, expectedVersion }) => {
    const resource = await ctx.db.get(resourceId);
    if (resource === null) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Resource no longer exists",
      });
    }

    // --- FreshGuard precondition: observation must still be current ---
    if (resource.version !== expectedVersion) {
      throw new ConvexError({
        code: "STALE_DEPENDENCY",
        message:
          "The observation your plan was based on has changed. " +
          "Re-read the resource and replan before acting.",
        observedVersion: expectedVersion,
        currentVersion: resource.version,
      });
    }

    // --- Business validation (independent of staleness; keep honest) ---
    if (!resource.available) {
      throw new ConvexError({
        code: "ALREADY_RESERVED",
        message: "Resource is no longer available",
      });
    }

    // --- Commit: reservation + version bump are atomic ---
    await ctx.db.patch(resourceId, {
      available: false,
      reservedBy: "agent",
      version: resource.version + 1,
      updatedAt: Date.now(),
    });

    return { ok: true, version: resource.version + 1 };
  },
});
```

### Rules that make this correct

- **Every write path must bump `version`.** `_creationTime` is not a version. If any mutation can patch the resource without incrementing `version`, the guarantee is broken.
- **Throw, don't return `{error}`.** A returned object is a successful commit; only throwing aborts the transaction. (If you prefer a result-union, the conflict branch must occur before any writes.)
- **Read tools return `version` alongside data** so the agent has something to echo back:

```ts
export const getResource = query({
  args: { resourceId: v.id("resources") },
  handler: async (ctx, { resourceId }) => {
    const r = await ctx.db.get(resourceId);
    if (!r) throw new ConvexError({ code: "NOT_FOUND", message: "Not found" });
    return {
      id: r._id, name: r.name, available: r.available,
      pricePerHour: r.pricePerHour,
      version: r.version,           // <-- the dependency token
    };
  },
});
```

## The MCP Layer

Expose `list_resources`, `get_resource`, `reserve_resource` as MCP tools. Key details:

- The write tool's schema *requires* `expectedVersion` — the agent cannot act without declaring what it observed.
- Map `ConvexError` payloads into the MCP tool result as a structured, model-readable error (e.g., `isError: true` with JSON content carrying `code`, `observedVersion`, `currentVersion`). Do not assume a raw exception survives to Claude intact — catch it in the tool handler and serialize it.
- In the tool *description*, tell the agent what to do on `STALE_DEPENDENCY`: "If you receive STALE_DEPENDENCY, re-read the resource and revise your plan." The error does not literally force a replan — the agent loop implements the refresh behavior, so make the instruction explicit.

## Enforcement Boundary (say this before a judge asks)

- Atomicity covers **the Convex database write**. Actually provisioning a GPU at an external provider is a third-party side effect — that belongs in an *action*, and protection there is best-effort revalidation, not a guaranteed transaction.
- One record's version proves only that record is unchanged. "Reserve item X if unchanged" is the honest MVP. Note: checking all previously observed records does **not** detect a newly inserted, cheaper option — global "cheapest available" correctness would need a collection/query revision covering relevant insertions, deletions, and updates, not merely versions for the existing candidates.
- Version checks do **not** replace inventory validation — the backend must still reject unavailable resources, for both guarded and unguarded runs.

## Sources

- Convex OCC and atomicity: [https://docs.convex.dev/database/advanced/occ](https://docs.convex.dev/database/advanced/occ)
- Convex application errors: [https://docs.convex.dev/functions/error-handling/application-errors](https://docs.convex.dev/functions/error-handling/application-errors)
- Convex mutations: [https://docs.convex.dev/functions/mutation-functions](https://docs.convex.dev/functions/mutation-functions)
