# FreshGuard

Stripe idempotency keys stopped duplicate charges; FreshGuard stops stale ones.

An agent reads the world, thinks for a while, and then writes. The write is based on a snapshot. The snapshot can go stale while the agent is thinking: the price changed, the item sold, or someone else edited the record. Most MCP tools still perform that write blindly.

The full context for a new teammate is [PROJECT_BRIEF.md](PROJECT_BRIEF.md).

## Docs

- `docs/reference/` — `DECISIONS.md` (what we follow when notes disagree) and `CURSOR_PROMPT.md` (the build contract).
- `docs/Perplexity_docs/` — market, competitors, Convex notes, pitch, and the combined brief.
- `docs/chatgpt_docs/` and `docs/chatgpt-docs_2.0/` — earlier system design, demo scripts, and schema sketches.
- `docs/gemini_docs/` — an alternate build plan, a VC framing, and a post-hackathon roadmap.
- `docs/founders_inc_nighthack_logistics_strategy.md` — NightHack timing and sponsors.
- `docs/when_agent_context_goes_stale.pdf` and `docs/real_faults_in_mcp.pdf` — the two papers.

## How to run

Requires Node 22.18+. Copy `.env.local.example` to `.env.local` and set `ANTHROPIC_API_KEY`, then `npm install`. Start each in its own terminal:

```bash
npm run dev:convex   # local Convex backend, port 3210
npm run dev:agent    # agent HTTP server, port 8787
npm run dev:ui       # Vite UI, port 5173
```

Open http://127.0.0.1:5173 and press **Run both**.

## Use it with your agent

FreshGuard is a stdio MCP server. Cursor picks up `.cursor/mcp.json` when you open this repo. For Claude Desktop, add the same entry to `~/Library/Application Support/Claude/claude_desktop_config.json` with an absolute path:

```json
{
  "mcpServers": {
    "freshguard-on": {
      "command": "node",
      "args": ["/absolute/path/to/FreshGuard/mcp/server.mjs"],
      "env": { "FRESHGUARD": "on", "CONVEX_URL": "http://127.0.0.1:3210" }
    }
  }
}
```

`npm run dev:convex` must be running. `FRESHGUARD=off` gives the unguarded version for comparison.

| Tool | Input | Returns |
|---|---|---|
| `read_inventory` | none | `{ items: [{ sku, name, available, pricePerHour, version }] }` |
| `reserve_inventory` | `sku`, `expectedVersion` (the row's `version` from your last read) | `{ success: true, ... }` or an error |

If the row changed since the agent read it, the write is rejected with:

```json
{ "code": "STALE_DEPENDENCY", "sku": "A100", "observedVersion": 1, "currentVersion": 2, "requiredAction": "READ_AND_REPLAN" }
```

The agent should call `read_inventory` again and re-plan, not retry the same call.

### Try it in Cursor

1. Enable `freshguard-on` in Cursor's MCP settings, then ask the agent: "Using freshguard-on, plan to reserve the cheapest GPU. Don't reserve yet."
2. In a terminal: `npm run reprice -- A100 9`
3. Tell the agent: "Go ahead and reserve it."
4. Watch it get `STALE_DEPENDENCY`, call `read_inventory` again, and switch to the H100, which is now cheaper at $5.

Built step by step at Founders Inc. NightHack.
