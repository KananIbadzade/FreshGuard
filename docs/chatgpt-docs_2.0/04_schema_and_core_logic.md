# FreshGuard — Convex Schema and Core Logic

## Important rule

Use an explicit integer `version` field.

Do not use `_creationTime` as a mutable version token.

Convex document types reference:

https://docs.convex.dev/database/types

---

# `convex/schema.ts`

```ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  inventory: defineTable({
    sku: v.string(),
    name: v.string(),
    available: v.number(),
    pricePerHour: v.number(),

    // FreshGuard dependency version.
    // Increment on every meaningful state change.
    version: v.number(),
  }).index("by_sku", ["sku"]),
});
```

---

# `convex/inventory.ts`

```ts
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Live inventory displayed by React and exposed to the agent.
 */
export const list = query({
  args: {},

  handler: async (ctx) => {
    return await ctx.db.query("inventory").collect();
  },
});

/**
 * Seed/reset the deterministic demo state.
 */
export const resetDemo = mutation({
  args: {},

  handler: async (ctx) => {
    const existing = await ctx.db.query("inventory").collect();

    for (const item of existing) {
      await ctx.db.delete("inventory", item._id);
    }

    const h100Id = await ctx.db.insert("inventory", {
      sku: "H100",
      name: "NVIDIA H100",
      available: 1,
      pricePerHour: 5,
      version: 1,
    });

    const a100Id = await ctx.db.insert("inventory", {
      sku: "A100",
      name: "NVIDIA A100",
      available: 2,
      pricePerHour: 3,
      version: 1,
    });

    return {
      h100Id,
      a100Id,
    };
  },
});

/**
 * Represents another user/process changing the world
 * while Claude is reasoning.
 */
export const simulateExternalReservation = mutation({
  args: {
    itemId: v.id("inventory"),
    quantity: v.number(),
  },

  handler: async (ctx, args) => {
    const item = await ctx.db.get("inventory", args.itemId);

    if (!item) {
      throw new ConvexError({
        code: "ITEM_NOT_FOUND",
      });
    }

    if (item.available < args.quantity) {
      throw new ConvexError({
        code: "INSUFFICIENT_INVENTORY",
        available: item.available,
        requested: args.quantity,
      });
    }

    await ctx.db.patch("inventory", args.itemId, {
      available: item.available - args.quantity,
      version: item.version + 1,
    });

    return {
      success: true,
      newVersion: item.version + 1,
    };
  },
});

/**
 * FreshGuard guarded commit.
 *
 * Important:
 * - Read CURRENT state.
 * - Validate expected version.
 * - Perform write.
 *
 * All inside the SAME Convex mutation.
 */
export const reserveWithVersion = mutation({
  args: {
    itemId: v.id("inventory"),
    quantity: v.number(),
    expectedVersion: v.number(),
  },

  handler: async (ctx, args) => {
    const item = await ctx.db.get("inventory", args.itemId);

    if (!item) {
      throw new ConvexError({
        code: "ITEM_NOT_FOUND",
      });
    }

    // FreshGuard check
    if (item.version !== args.expectedVersion) {
      throw new ConvexError({
        code: "STALE_DEPENDENCY",
        itemId: args.itemId,
        sku: item.sku,
        expectedVersion: args.expectedVersion,
        currentVersion: item.version,
        requiredAction: "READ_AND_REPLAN",
      });
    }

    // Normal business invariant
    if (item.available < args.quantity) {
      throw new ConvexError({
        code: "INSUFFICIENT_INVENTORY",
        available: item.available,
        requested: args.quantity,
      });
    }

    const newVersion = item.version + 1;

    await ctx.db.patch("inventory", args.itemId, {
      available: item.available - args.quantity,
      version: newVersion,
    });

    return {
      success: true,
      sku: item.sku,
      reserved: args.quantity,
      remaining: item.available - args.quantity,
      newVersion,
    };
  },
});
```

---

# Why this is atomic

The relevant logic:

```ts
const item = await ctx.db.get("inventory", args.itemId);

if (item.version !== args.expectedVersion) {
  throw ...
}

await ctx.db.patch(...);
```

is one Convex mutation.

It is **not**:

```text
transaction 1: check
transaction 2: write
```

Convex mutation docs:

https://docs.convex.dev/functions/mutation-functions

OCC docs:

https://docs.convex.dev/database/advanced/occ

---

# Dangerous implementation

Do not do this:

```ts
const current = await convex.query(...);

if (current.version === expectedVersion) {
  // TIME PASSES HERE
  await convex.mutation(reserveWithoutCheckingAgain);
}
```

That creates:

```text
CHECK
|
v
world changes
|
v
ACT
```

The check must be in the same mutation as the write.

---

# Core invariant

```text
COMMIT <=> V_observed = V_current
```

Else:

```text
STALE_DEPENDENCY
```

---

# Optional multi-resource dependency design

If time allows:

```json
{
  "dependencies": [
    {
      "resource": "inventory:H100",
      "version": 7
    },
    {
      "resource": "budget:user123",
      "version": 12
    },
    {
      "resource": "policy:gpuReservation",
      "version": 4
    }
  ]
}
```

Before commit:

```text
inventory   7 == 7   OK
budget     12 == 13  STALE
policy      4 == 4   OK

STALE_DEPENDENCY
resource = budget
```

This is the path from a single-row optimistic version check to a general **agent dependency validation protocol**.
