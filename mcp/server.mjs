import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { api } from "../convex/_generated/api.js";

const convexUrl = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;
if (!convexUrl) {
  console.error("CONVEX_URL is not set");
  process.exit(1);
}

// stdout carries MCP protocol only. Convex's default logger prints function logs with console.log.
const stderrLogger = {
  log: console.error,
  warn: console.error,
  error: console.error,
  logVerbose: () => {},
};
const convex = new ConvexHttpClient(convexUrl, { logger: stderrLogger });
const guarded = process.env.FRESHGUARD === "on";

function errorPayload(err) {
  if (err instanceof ConvexError) return err.data;
  if (err && typeof err === "object" && "data" in err && err.data && typeof err.data === "object") {
    return err.data;
  }
  console.error(err);
  return {
    code: "ERROR",
    message: err instanceof Error ? err.message : String(err),
  };
}

function jsonResult(value, isError = false) {
  return {
    isError,
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

const server = new McpServer({ name: "freshguard", version: "0.1.0" });

server.registerTool(
  "read_inventory",
  {
    description:
      "Read GPU inventory. Returns JSON {items:[{sku,name,available,pricePerHour,version}]}. Call once before reserving. On STALE_DEPENDENCY, call this again and re-plan. Do not retry the same reserve call.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    try {
      const rows = await convex.query(api.inventory.list, {});
      return jsonResult({
        items: rows.map((item) => ({
          sku: item.sku,
          name: item.name,
          available: item.available,
          pricePerHour: item.pricePerHour,
          version: item.version,
        })),
      });
    } catch (err) {
      return jsonResult(errorPayload(err), true);
    }
  },
);

if (guarded) {
  server.registerTool(
    "reserve_inventory",
    {
      description:
        "Reserve one unit of sku. Pass expectedVersion = the version of that same sku's row in the latest read_inventory result you used to decide. Versions are per row. If you receive STALE_DEPENDENCY, do not retry this call and do not reuse the old version. Call read_inventory again and re-plan.",
      inputSchema: {
        sku: z.string().describe("GPU sku from read_inventory"),
        expectedVersion: z
          .number()
          .describe("version of this sku's row in the read_inventory snapshot this decision uses"),
      },
    },
    async ({ sku, expectedVersion }) => {
      try {
        const result = await convex.mutation(api.inventory.reserveGuarded, {
          sku,
          expectedVersion,
        });
        return jsonResult(result);
      } catch (err) {
        return jsonResult(errorPayload(err), true);
      }
    },
  );
} else {
  server.registerTool(
    "reserve_inventory",
    {
      description: "Reserve one unit of sku. Pass only sku. This path does not check a version.",
      inputSchema: {
        sku: z.string().describe("GPU sku from read_inventory"),
      },
    },
    async ({ sku }) => {
      try {
        const result = await convex.mutation(api.inventory.reserveUnguarded, { sku });
        return jsonResult(result);
      } catch (err) {
        return jsonResult(errorPayload(err), true);
      }
    },
  );
}

await server.connect(new StdioServerTransport());
