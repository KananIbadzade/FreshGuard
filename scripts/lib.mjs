import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export { api } from "../convex/_generated/api.js";

const convexUrl = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;
if (!convexUrl) {
  console.error("FAIL CONVEX_URL is not set. Start `npm run dev:convex` first.");
  process.exit(1);
}

export const convex = new ConvexHttpClient(convexUrl);

let failures = 0;

export function check(name, ok, actual) {
  const suffix = !ok && actual !== undefined ? ` (got ${JSON.stringify(actual)})` : "";
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${suffix}`);
  if (!ok) failures += 1;
}

export function done(label) {
  if (failures > 0) {
    console.log(`${label}: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log(`${label}: all checks passed`);
}

export function errorData(err) {
  if (err instanceof ConvexError) return err.data;
  if (err && typeof err === "object" && err.data && typeof err.data === "object") {
    return err.data;
  }
  return { code: "ERROR", message: err instanceof Error ? err.message : String(err) };
}

export async function attempt(promise) {
  try {
    return { ok: true, value: await promise };
  } catch (err) {
    return { ok: false, data: errorData(err) };
  }
}

export async function withMcp(mode, fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["mcp/server.mjs"],
    cwd: process.cwd(),
    env: { ...process.env, FRESHGUARD: mode },
    stderr: "inherit",
  });
  const client = new Client({ name: "freshguard-test", version: "0.1.0" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

export async function callTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.find((part) => part.type === "text")?.text ?? "";
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { isError: Boolean(result.isError), body };
}
