# FreshGuard: build prompt for Cursor Agent

You are building FreshGuard in this empty repo for a 5-hour hackathon (demos at 10:00 PM PT). Keep it small, working, and demo-proof. Build in the gated phases below. At the end of each phase, run its gate and show me the output. Do not move on until the gate passes. Don't add features I didn't ask for.

## What FreshGuard is
A freshness guard for AI agent writes over MCP. Every read returns the data plus a `version`. Every write must send back the `expectedVersion` it saw. One atomic Convex mutation compares versions. If they match, it commits and bumps the version. If they don't, it throws a structured `STALE_DEPENDENCY` error that tells the agent to re-read and re-plan, never to retry blindly.

Demo story: an agent has a $6/hr budget and wants the best GPU it can afford. It reads the inventory (H100 at $5/hr, A100 at $3/hr) and plans to buy the H100. While it is thinking, the seller reprices the H100 to $10. The unguarded agent's blind write succeeds and overspends. The guarded agent gets STALE_DEPENDENCY, re-reads, and buys the A100 at $3. Both agents use the same backend and model. Only `expectedVersion` differs.

## Stack (keep it exactly this)
- Node 22 or newer (I have 24), TypeScript where easy, ESM.
- Convex running locally with `npx convex dev`. It runs anonymously, so there's no account and no cloud deploy.
- `@modelcontextprotocol/sdk` for an MCP stdio server, `zod` for schemas.
- `@anthropic-ai/sdk` for the agent. Read `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` from `.env.local`, and never hardcode a model id.
- Vite + React + `convex/react` for the UI. Plain CSS, no component library.

## Target layout (~11 files, ~750 LOC total)
```
convex/schema.ts          inventory {sku,name,available,pricePerHour,version} indexed by sku; events {kind,sku,detail,mode?,runId?}
convex/inventory.ts       list, events (latest 30), resetDemo, reserveGuarded, reserveUnguarded, externalReprice, externalReserve, logEvent
mcp/server.mjs            tools read_inventory + reserve_inventory; FRESHGUARD=on|off env flag
agent/systemPrompt.ts     budget rule + "on STALE_DEPENDENCY: call read_inventory again and re-plan, never repeat the same call"
agent/run.ts              Claude tool loop that spawns the MCP server as a client, maps MCP tools to Anthropic tools, logs each step to Convex events
agent/http.ts             tiny Node http server: POST /run {mode}, POST /run-both
src/main.tsx              ConvexProvider bootstrap
src/App.tsx               layout + buttons: Run both, Reprice H100 to $10, Reset
src/InventoryPanel.tsx    live inventory rows with a version badge
src/TracePanel.tsx        one column per mode: step trace, red STALE card, receipt (paid vs $6 budget)
scripts/race-test.mjs     deterministic gate tests (no LLM)
```

## Phase 1: transaction core (gate by 5:40 PM)
- Schema as above. Every write path, including the external ones, must bump `version`.
- `reserveGuarded({sku, expectedVersion})` reads the item by index, compares versions, checks `available >= 1`, then patches (decrement available, version+1) and inserts a COMMIT event, all in ONE mutation. On mismatch it throws `ConvexError({code:"STALE_DEPENDENCY", sku, observedVersion, currentVersion, requiredAction:"READ_AND_REPLAN"})`. The throw rolls back inserts in the same mutation, so STALE events get logged by the caller through `logEvent`.
- `reserveUnguarded({sku})` does the same write without the version check. It's the baseline.
- `externalReprice({sku, pricePerHour})` and `externalReserve({sku})` simulate another seller or buyer, bump the version, and log an EXTERNAL event.
- `resetDemo` seeds H100 (1 unit, $5, v1) and A100 (2 units, $3, v1) and clears events.
- **Gate:** `scripts/race-test.mjs` fires 20 parallel `reserveGuarded` on A100 with expectedVersion 1. Expect exactly 1 success, 19 STALE_DEPENDENCY, and inventory never negative.

## Phase 2: MCP server (gate by 6:20 PM)
- `read_inventory` (readOnlyHint) returns `{items:[{sku,name,available,pricePerHour,version}]}` as JSON text.
- `reserve_inventory`: when FRESHGUARD=on, input is `{sku, expectedVersion}` and the description tells the agent to pass the version from its latest read and, on STALE_DEPENDENCY, to re-read instead of retrying. When off, input is `{sku}`. Errors come back as `isError: true` with the JSON payload.
- **Gate:** extend race-test.mjs with a deterministic harness (no LLM). It connects as an MCP client over stdio, reads, triggers `externalReprice H100 -> $10` between the read and the write, then runs a "most expensive GPU that's ≤ $6 and available" policy with up to 3 attempts. Run 10 times per mode. Expect guarded 0/10 over budget and unguarded 10/10 over budget. Print one sample trace per mode.

## Phase 3: Claude agent (gate by 7:20 PM)
- `agent/run.ts` exports `runAgent(mode, runId)`. It spawns the MCP server with the FRESHGUARD flag, lists its tools, converts them to Anthropic tool definitions, and loops until the model stops calling tools (max 8 turns).
- **Barrier (makes the race deterministic):** after the FIRST `read_inventory` result, pause the run until the Reprice has happened. In `/run-both`, the server fires `externalReprice` itself once both agents have done their first read. Say this out loud in the demo, because the trigger is scripted but the agent's reaction is live.
- Log every step to Convex events with mode and runId: READ, TOOL_CALL, STALE, COMMIT, and FINAL with the model's one-line summary.
- `agent/http.ts`: POST /run-both runs `resetDemo`, then both modes in parallel against the same backend, then returns. Add CORS for the Vite dev server.
- **Gate:** run /run-both 5 times from curl. Expect unguarded to end on H100 at $10 and guarded to end on A100 at $3. If it's flaky, tighten the system prompt or tool descriptions before touching the UI.

## Phase 4: UI (gate by 8:20 PM)
- Split screen on a dark background. The top strip shows live inventory from `useQuery` with a version badge that flashes when it changes. Below it are two columns, "Without FreshGuard" and "With FreshGuard", each showing that mode's event trace live.
- The STALE event renders as a red card: "Stale: you saw v1, it's now v2. Re-read and re-plan."
- Each column ends in a receipt: GPU, price paid, budget $6, and a red OVER BUDGET or a green WITHIN BUDGET badge.
- Buttons: "Run both" (POST /run-both), "Reset", and a manual "Reprice H100 → $10" for the narrated version.
- **Gate:** a full run from the browser 3 times in a row with no reloads.

## Phase 5 (only if everything above is green): stampede kicker
A button that fires 20 parallel guarded writes on the last A100 and shows a counter: 1 committed, 19 stale, inventory never negative.

## Cut order if we're behind
Cut the stampede first, then receipt polish, then the http endpoint (trigger runs from a script instead), then MCP stdio (expose the same two functions as plain Anthropic tools with identical schemas). Never cut the version field, the atomic check, the STALE_DEPENDENCY payload, the re-read and re-plan, or the side-by-side baseline on the same backend.

## Housekeeping
- Add `.env.local.example` with ANTHROPIC_API_KEY, ANTHROPIC_MODEL, and CONVEX_URL=http://127.0.0.1:3210.
- Add npm scripts: `dev:convex`, `dev:agent`, `dev:ui`, `test:race`.
- Write a 15-line README covering how to run it and the one-sentence pitch: "Stripe idempotency keys stopped duplicate charges; FreshGuard stops stale ones."
