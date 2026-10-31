import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";

async function bySku(ctx: MutationCtx, sku: string) {
  const item = await ctx.db
    .query("inventory")
    .withIndex("by_sku", (q) => q.eq("sku", sku))
    .unique();
  if (!item) {
    throw new ConvexError({ code: "ITEM_NOT_FOUND", sku });
  }
  return item;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const items = await ctx.db.query("inventory").collect();
    const order = ["H100", "A100"];
    return items.sort(
      (a, b) => order.indexOf(a.sku) - order.indexOf(b.sku),
    );
  },
});

export const events = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("events").order("desc").take(30);
    return rows.reverse();
  },
});

export const logEvent = mutation({
  args: {
    kind: v.string(),
    sku: v.optional(v.string()),
    detail: v.string(),
    mode: v.optional(v.string()),
    runId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("events", args);
  },
});

export const resetDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const items = await ctx.db.query("inventory").collect();
    for (const item of items) {
      await ctx.db.delete(item._id);
    }
    const logs = await ctx.db.query("events").collect();
    for (const log of logs) {
      await ctx.db.delete(log._id);
    }

    await ctx.db.insert("inventory", {
      sku: "H100",
      name: "NVIDIA H100",
      available: 1,
      pricePerHour: 5,
      version: 1,
    });
    await ctx.db.insert("inventory", {
      sku: "A100",
      name: "NVIDIA A100",
      available: 2,
      pricePerHour: 3,
      version: 1,
    });
  },
});

export const reserveGuarded = mutation({
  args: {
    sku: v.string(),
    expectedVersion: v.number(),
  },
  handler: async (ctx, args) => {
    const item = await bySku(ctx, args.sku);
    if (item.version !== args.expectedVersion) {
      throw new ConvexError({
        code: "STALE_DEPENDENCY",
        sku: item.sku,
        observedVersion: args.expectedVersion,
        currentVersion: item.version,
        requiredAction: "READ_AND_REPLAN",
      });
    }
    if (item.available < 1) {
      throw new ConvexError({
        code: "INSUFFICIENT_INVENTORY",
        sku: item.sku,
        available: item.available,
      });
    }
    const version = item.version + 1;
    const available = item.available - 1;
    await ctx.db.patch(item._id, { available, version });
    await ctx.db.insert("events", {
      kind: "COMMIT",
      sku: item.sku,
      detail: JSON.stringify({
        pricePerHour: item.pricePerHour,
        available,
        version,
      }),
    });
    return {
      success: true as const,
      sku: item.sku,
      pricePerHour: item.pricePerHour,
      available,
      version,
    };
  },
});

export const reserveUnguarded = mutation({
  args: { sku: v.string() },
  handler: async (ctx, args) => {
    const item = await bySku(ctx, args.sku);
    if (item.available < 1) {
      throw new ConvexError({
        code: "INSUFFICIENT_INVENTORY",
        sku: item.sku,
        available: item.available,
      });
    }
    const version = item.version + 1;
    const available = item.available - 1;
    await ctx.db.patch(item._id, { available, version });
    await ctx.db.insert("events", {
      kind: "COMMIT",
      sku: item.sku,
      detail: JSON.stringify({
        pricePerHour: item.pricePerHour,
        available,
        version,
      }),
    });
    return {
      success: true as const,
      sku: item.sku,
      pricePerHour: item.pricePerHour,
      available,
      version,
    };
  },
});

export const externalReprice = mutation({
  args: {
    sku: v.string(),
    pricePerHour: v.number(),
  },
  handler: async (ctx, args) => {
    const item = await bySku(ctx, args.sku);
    const version = item.version + 1;
    await ctx.db.patch(item._id, {
      pricePerHour: args.pricePerHour,
      version,
    });
    await ctx.db.insert("events", {
      kind: "EXTERNAL",
      sku: item.sku,
      detail: JSON.stringify({
        action: "reprice",
        pricePerHour: args.pricePerHour,
        version,
      }),
    });
    return { sku: item.sku, pricePerHour: args.pricePerHour, version };
  },
});

export const externalReserve = mutation({
  args: { sku: v.string() },
  handler: async (ctx, args) => {
    const item = await bySku(ctx, args.sku);
    if (item.available < 1) {
      throw new ConvexError({
        code: "INSUFFICIENT_INVENTORY",
        sku: item.sku,
        available: item.available,
      });
    }
    const version = item.version + 1;
    const available = item.available - 1;
    await ctx.db.patch(item._id, { available, version });
    await ctx.db.insert("events", {
      kind: "EXTERNAL",
      sku: item.sku,
      detail: JSON.stringify({ action: "reserve", available, version }),
    });
    return { sku: item.sku, available, version };
  },
});
