# FreshGuard

Stripe idempotency keys stopped duplicate charges; FreshGuard stops stale ones.

Demo video: https://youtu.be/2hIxNXGYd9s

An agent reads the world, thinks, then writes. The write sends back the `version` it saw. If that row changed, the write is rejected with `STALE_DEPENDENCY` and the agent re-reads instead of retrying.

## How to run

Requires Node 22.18+. Copy `.env.local.example` to `.env.local`, then `npm install`.

The first `npm run dev:convex` may ask you to pick a project. Choose local (no account). `ANTHROPIC_API_KEY` is only needed for `dev:agent` and `test:live`. The MCP server and `npm test` run without it.

Start each in its own terminal:

```bash
npm run dev:convex   # local Convex backend, port 3210
npm run dev:agent    # agent HTTP server, port 8787
npm run dev:ui       # Vite UI, port 5173
```

Open http://127.0.0.1:5173 and press **Run both**. After each read the trace shows **Thinking…** for about 3 seconds. **Reprice H100 → $10** is clickable during that pause.

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

`npm run dev:convex` must be running. `FRESHGUARD=off` is the unguarded comparison. Unset is the same as `off`.

| Tool | Input | Returns |
|---|---|---|
| `read_inventory` | none | `{ items: [{ sku, name, available, pricePerHour, version }] }` |
| `reserve_inventory` | `sku`, and `expectedVersion` when `FRESHGUARD=on` (the row's `version` from the read you decided on) | `{ success: true, ... }` or an error |

If the row changed since that read, the write is rejected:

```json
{ "code": "STALE_DEPENDENCY", "sku": "A100", "observedVersion": 1, "currentVersion": 2, "requiredAction": "READ_AND_REPLAN" }
```

The agent should call `read_inventory` again and make a new plan. Retrying the same call fails the same way.

### Try it in Cursor

1. Enable `freshguard-on` in Cursor's MCP settings, then ask the agent: "Using freshguard-on, plan to reserve the cheapest GPU. Don't reserve yet."
2. In a terminal: `npm run reprice -- A100 9`
3. Tell the agent: "Go ahead and reserve it."
4. It should get `STALE_DEPENDENCY`, call `read_inventory` again, and switch to the H100, now cheaper at $5.

Built step by step at Founders Inc. NightHack.

## Docs

- [PROJECT_BRIEF.md](PROJECT_BRIEF.md) — short overview of the product.
- [docs/reference/DECISIONS.md](docs/reference/DECISIONS.md) — schema, error contract, and what shipped.

## References

- [When Agent Context Goes Stale…](https://arxiv.org/abs/2610.05281)
- [Real Faults in Model Context Protocol (MCP) Software…](https://arxiv.org/abs/2603.05637) (also published in ACM TOSEM)
