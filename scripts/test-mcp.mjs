import { spawn } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { api, callTool, check, convex, done, withMcp } from "./lib.mjs";

function reserveTool(tools) {
  return tools.find((tool) => tool.name === "reserve_inventory");
}

const rawSession = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "0" } } },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "read_inventory", arguments: {} } },
  { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "reserve_inventory", arguments: { sku: "H100", expectedVersion: 0 } } },
];

function runRaw(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["mcp/server.mjs"], { env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => child.kill(), 15000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(rawSession.map((msg) => JSON.stringify(msg)).join("\n") + "\n");
  });
}

function protocolOnly(stdout) {
  const lines = stdout.split("\n").filter(Boolean);
  const nonProtocol = lines.filter((line) => {
    try {
      return JSON.parse(line).jsonrpc !== "2.0";
    } catch {
      return true;
    }
  });
  const ids = lines.map((line) => JSON.parse(line).id).filter((id) => id !== undefined).sort();
  return { nonProtocol, ids };
}

await convex.mutation(api.inventory.resetDemo, {});
{
  const run = await runRaw({ FRESHGUARD: "on" });
  const { nonProtocol, ids } = protocolOnly(run.stdout);
  check("stdout: every line is JSON-RPC (live Convex)", nonProtocol.length === 0, nonProtocol);
  check("stdout: answered initialize, read, and stale reserve", isDeepStrictEqual(ids, [1, 2, 3]), ids);
}
{
  const run = await runRaw({ FRESHGUARD: "on", CONVEX_URL: "http://127.0.0.1:1" });
  const { nonProtocol, ids } = protocolOnly(run.stdout);
  check("stdout: every line is JSON-RPC (Convex unreachable)", nonProtocol.length === 0, nonProtocol);
  check("stdout: still answers all requests when Convex is down", isDeepStrictEqual(ids, [1, 2, 3]), ids);
  check("stderr: Convex connection error is logged", run.stderr.length > 0, run.stderr);
}
{
  const run = await runRaw({ FRESHGUARD: "on", CONVEX_URL: "", VITE_CONVEX_URL: "" });
  check("missing CONVEX_URL: exits 1 with nothing on stdout", run.code === 1 && run.stdout === "", run);
  check("missing CONVEX_URL: reason goes to stderr", run.stderr.includes("CONVEX_URL is not set"), run.stderr);
}

await withMcp("on", async (client) => {
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name).sort();
  check(
    "on: exactly read_inventory and reserve_inventory",
    isDeepStrictEqual(names, ["read_inventory", "reserve_inventory"]),
    names,
  );
  const read = tools.find((tool) => tool.name === "read_inventory");
  check("on: read_inventory is readOnlyHint", read?.annotations?.readOnlyHint === true, read?.annotations);
  const required = [...(reserveTool(tools)?.inputSchema?.required ?? [])].sort();
  check(
    "on: reserve_inventory requires sku and expectedVersion",
    isDeepStrictEqual(required, ["expectedVersion", "sku"]),
    required,
  );

  await convex.mutation(api.inventory.resetDemo, {});
  const snapshot = await callTool(client, "read_inventory", {});
  check(
    "on: read_inventory returns sku/name/available/pricePerHour/version only",
    isDeepStrictEqual(snapshot.body?.items?.[0], {
      sku: "H100",
      name: "NVIDIA H100",
      available: 1,
      pricePerHour: 5,
      version: 1,
    }),
    snapshot.body?.items?.[0],
  );

  await convex.mutation(api.inventory.externalReprice, { sku: "H100", pricePerHour: 10 });
  const stale = await callTool(client, "reserve_inventory", { sku: "H100", expectedVersion: 1 });
  check("on: stale reserve comes back as isError", stale.isError, stale);
  check(
    "on: stale reserve body is the exact STALE_DEPENDENCY payload",
    isDeepStrictEqual(stale.body, {
      code: "STALE_DEPENDENCY",
      sku: "H100",
      observedVersion: 1,
      currentVersion: 2,
      requiredAction: "READ_AND_REPLAN",
    }),
    stale.body,
  );

  const fresh = await callTool(client, "reserve_inventory", { sku: "A100", expectedVersion: 1 });
  check(
    "on: fresh reserve commits A100 at $3",
    !fresh.isError && fresh.body?.success === true && fresh.body?.pricePerHour === 3,
    fresh,
  );
});

await withMcp("off", async (client) => {
  const { tools } = await client.listTools();
  const schema = reserveTool(tools)?.inputSchema;
  check(
    "off: reserve_inventory requires only sku",
    isDeepStrictEqual(schema?.required, ["sku"]),
    schema?.required,
  );
  check(
    "off: reserve_inventory has no expectedVersion argument",
    !("expectedVersion" in (schema?.properties ?? {})),
    schema?.properties,
  );

  await convex.mutation(api.inventory.resetDemo, {});
  await callTool(client, "read_inventory", {});
  await convex.mutation(api.inventory.externalReprice, { sku: "H100", pricePerHour: 10 });
  const blind = await callTool(client, "reserve_inventory", { sku: "H100" });
  check(
    "off: reserve after reprice commits H100 at $10",
    !blind.isError && blind.body?.success === true && blind.body?.pricePerHour === 10,
    blind,
  );
});

await convex.mutation(api.inventory.resetDemo, {});
done("test:mcp");
