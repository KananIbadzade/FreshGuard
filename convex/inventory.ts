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
