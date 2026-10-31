import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ConvexHttpClient } from "convex/browser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "../convex/_generated/api.js";
import { SYSTEM_PROMPT } from "./systemPrompt.ts";

export type Mode = "on" | "off";

export type Commit = {
  sku: string;
  pricePerHour: number;
};

export type RunResult = {
  mode: Mode;
  runId: string;
  summary: string;
  commits: Commit[];
  staleCount: number;
};

type LogArgs = {
  kind: string;
  detail: string;
  mode: Mode;
  runId: string;
  sku?: string;
};

const TASK =
  "Buy the best GPU you can afford. Budget is $6 per hour. Reserve the available GPU with the highest pricePerHour that is still at most 6.";
const MAX_TURNS = 8;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function textOf(result: { content?: Array<{ type: string; text?: string }> }) {
  const block = result.content?.find((part) => part.type === "text");
  return block?.text ?? "";
}

function joinText(content: Anthropic.ContentBlock[]) {
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    if (value && typeof value === "object") return value as Record<string, unknown>;
  } catch {
    return null;
  }
  return null;
}

function skuOf(input: unknown) {
  if (input && typeof input === "object" && "sku" in input) {
    const sku = (input as { sku?: unknown }).sku;
    return typeof sku === "string" ? sku : undefined;
  }
  return undefined;
}

export async function runAgent(
  mode: Mode,
  runId: string,
  opts?: { afterFirstRead?: () => Promise<void> },
): Promise<RunResult> {
  const model = requireEnv("ANTHROPIC_MODEL");
  const apiKey = requireEnv("ANTHROPIC_API_KEY");
  const convexUrl = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;
  if (!convexUrl) throw new Error("CONVEX_URL is not set");

  const convex = new ConvexHttpClient(convexUrl);
  const log = (args: LogArgs) => convex.mutation(api.inventory.logEvent, args);

  const childEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") childEnv[key] = value;
  }
  childEnv.FRESHGUARD = mode;

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, "mcp", "server.mjs")],
    cwd: root,
    env: childEnv,
    stderr: "inherit",
  });
  const mcp = new Client({ name: "freshguard-agent", version: "0.1.0" });
  await mcp.connect(transport);

  try {
    const listed = await mcp.listTools();
    const tools: Anthropic.Tool[] = listed.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
    }));

    const anthropic = new Anthropic({ apiKey });
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: TASK }];
    const commits: Commit[] = [];
    let staleCount = 0;
    let summary = "";
    let seenRead = false;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await anthropic.messages.create({
        model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools,
        messages,
      });

      const toolUses = response.content.filter((block) => block.type === "tool_use");
      if (toolUses.length === 0) {
        summary = joinText(response.content);
        break;
      }

      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];

      for (const call of toolUses) {
        await log({
          kind: "TOOL_CALL",
          detail: JSON.stringify({ name: call.name, input: call.input }),
          mode,
          runId,
          sku: skuOf(call.input),
        });

        const result = await mcp.callTool({
          name: call.name,
          arguments: (call.input ?? {}) as Record<string, unknown>,
        });
        const text = textOf(result as { content?: Array<{ type: string; text?: string }> });
        const parsed = parseJson(text);

        if (call.name === "read_inventory") {
          await log({ kind: "READ", detail: text, mode, runId });
          if (!seenRead) {
            seenRead = true;
            if (opts?.afterFirstRead) await opts.afterFirstRead();
          }
        }

        if (call.name === "reserve_inventory" && parsed?.code === "STALE_DEPENDENCY") {
          staleCount += 1;
          await log({
            kind: "STALE",
            sku: typeof parsed.sku === "string" ? parsed.sku : skuOf(call.input),
            detail: JSON.stringify(parsed),
            mode,
            runId,
          });
        } else if (call.name === "reserve_inventory" && parsed?.success === true) {
          const commit = { sku: String(parsed.sku), pricePerHour: Number(parsed.pricePerHour) };
          commits.push(commit);
          await log({ kind: "COMMIT", sku: commit.sku, detail: JSON.stringify(parsed), mode, runId });
        }

        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: text,
          is_error: Boolean(result.isError),
        });
      }

      if (commits.length === 0) {
        messages.push({ role: "user", content: results });
        continue;
      }

      messages.push({
        role: "user",
        content: [
          ...results,
          {
            type: "text",
            text: "The reserve succeeded and is final. Reply with one line: sku and price per hour paid. Do not call tools.",
          },
        ],
      });
      const finalResponse = await anthropic.messages.create({
        model,
        max_tokens: 200,
        system: SYSTEM_PROMPT,
        messages,
      });
      summary = joinText(finalResponse.content);
      break;
    }

    summary ||= "stopped before a final summary";
    await log({ kind: "FINAL", detail: summary, mode, runId });
    return { mode, runId, summary, commits, staleCount };
  } finally {
    await mcp.close();
  }
}
