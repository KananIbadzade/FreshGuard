import { isDeepStrictEqual } from "node:util";
import { api, callTool, check, convex, done, withMcp } from "./lib.mjs";

function reserveTool(tools) {
  return tools.find((tool) => tool.name === "reserve_inventory");
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
