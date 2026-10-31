import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  inventory: defineTable({
    sku: v.string(),
    name: v.string(),
    available: v.number(),
    pricePerHour: v.number(),
    version: v.number(),
  }).index("by_sku", ["sku"]),

  events: defineTable({
    kind: v.string(),
    sku: v.optional(v.string()),
    detail: v.string(),
    mode: v.optional(v.string()),
    runId: v.optional(v.string()),
  }),
});
