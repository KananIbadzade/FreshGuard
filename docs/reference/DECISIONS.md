# FreshGuard — decisions and technical context

This file records what was actually built, why, and where the research docs disagree with the code. It is the context for the running hackathon demo, not a second spec.

Pitch line: Stripe idempotency keys stopped duplicate charges; FreshGuard stops stale ones.

## What the demo proves

An agent has a $6/hr budget and wants the most expensive GPU it can afford. It reads inventory (H100 at $5/hr, A100 at $3/hr) and plans to buy the H100. While it is holding that snapshot, the seller reprices the H100 to $10. Both agents use the same Convex backend and the same model. The only difference is whether the write carries `expectedVersion`.

- Unguarded (`FRESHGUARD=off`): the write has no version check. It commits the H100 at the new price, $10, and the receipt is OVER BUDGET.
- Guarded (`FRESHGUARD=on`): the write throws `STALE_DEPENDENCY`. The agent re-reads, sees the H100 is now $10, and buys the A100 at $3. The receipt is WITHIN BUDGET.

The reprice in **Run both** is scripted. The agent's reaction is live. Say that out loud. Do not imply the model noticed the race by itself, and do not imply Convex held a lock while the model was thinking.

## Which document won

`CURSOR_PROMPT.md` is the build contract. The files under `docs/` are research and earlier designs. Where they conflict, the prompt and this code win.

| Earlier docs | What the code does |
|---|---|
| Reserve by Convex document id (`itemId`) | Reserve by `sku`, looked up on the `by_sku` index |
| `reserveWithVersion` / `simulateExternalReservation` | `reserveGuarded`, `reserveUnguarded`, `externalReprice`, `externalReserve` |
| Error field `expectedVersion` | Error field `observedVersion` (the version the caller claimed to have seen) plus `currentVersion` |
| One agent and a manual "continue" pause | Two agents in parallel. `/run-both` pauses both after the first read, then reprices |
| `version_id`, boolean `available` | Integer `version`, numeric `available` (unit count) |
| MCP packages `@modelcontextprotocol/server` and `client` (SDK v2) | `@modelcontextprotocol/sdk` 1.32, as the prompt named |

Things the docs describe and this repo does not implement: multi-resource dependency sets, auth, audit history beyond the last 30 events, cloud deploy, a manual continue button, quantity other than 1.

## The invariant

```text
COMMIT  <=>  version on the row  ==  expectedVersion on the write
```

Otherwise the mutation throws and writes nothing:

```text
STALE_DEPENDENCY
requiredAction: READ_AND_REPLAN
```

Recovery is refresh, then a new plan, then a new write. It is not "retry the same call."

### Why Convex OCC is not the product

Every Convex mutation is already one serializable transaction. Optimistic concurrency control reruns a mutation when a document it read was changed by a commit that landed first. That protects work inside a single mutation.

An agent does this instead:

```text
READ  ->  version 1 is now inside the model context
          (seconds of thinking, or a scripted pause)
WRITE ->  a new mutation, later
```

You cannot hold the Convex transaction open across that gap. Mutations must be deterministic and cannot call a model. FreshGuard carries the earlier observation in as an argument, `expectedVersion`. The check is ordinary application code inside the new mutation. If OCC reruns the mutation after a conflicting commit, the rerun reads the new version, the comparison fails, and it throws. The throw is deterministic, so OCC will not "retry until it succeeds" past a stale observation.

The check and the stock decrement are in the same mutation. A version compare in Node, followed by a separate mutation that trusts the compare, is a time-of-check/time-of-use bug. Do not add that.

## Process layout

Three local processes. No cloud account.

| Process | Command | Address |
|---|---|---|
| Convex backend and function push | `npm run dev:convex` | `http://127.0.0.1:3210` |
| Agent HTTP plus the Claude loop | `npm run dev:agent` | `http://127.0.0.1:8787` |
| Vite React UI | `npm run dev:ui` | `http://127.0.0.1:5173` |

`npx convex dev` in a non-interactive shell provisions an anonymous local deployment and writes `CONVEX_DEPLOYMENT=anonymous:anonymous-FreshGuard` into `.env.local`. State lives on this machine. The backend is a child of `convex dev` and exits when that process exits. Queries and mutations from the UI, the MCP server, and the race test all fail if `dev:convex` is not running.

`CONVEX_URL` is what Node reads. Vite only exposes `VITE_*` variables, so `vite.config.ts` copies `CONVEX_URL` into `import.meta.env.VITE_CONVEX_URL`. Convex also writes `VITE_CONVEX_SITE_URL` (port 3211) for HTTP actions. This demo has no HTTP actions and does not use that URL.

Node is 22 or newer. This machine is Node 24. Agent TypeScript is executed by Node's type stripper (`node agent/http.ts`), not by a compile step. Imports inside `agent/` use the `.ts` extension because of that. `"type": "module"` is set, so Convex's generated `api.js` loads as ESM.

The model id is only `ANTHROPIC_MODEL` from `.env.local`. Nothing in the repo hardcodes one. Both keys are empty until someone fills them. `/run-both` checks them before `resetDemo`, so a missing key does not wipe the demo. Restart `dev:agent` after editing `.env.local`. `--env-file` is read at process start.

## Data model

`convex/schema.ts`.

`inventory`, indexed by `sku`:

| Field | Demo seed |
|---|---|
| `sku` | `H100`, `A100` |
| `name` | `NVIDIA H100`, `NVIDIA A100` |
| `available` | 1 and 2 |
| `pricePerHour` | 5 and 3 |
| `version` | 1 and 1 |

`version` is an explicit integer. `_creationTime` is not a version. Creation time does not change when a row is patched, so it cannot detect a reprice.

Every write path bumps `version` by 1: guarded reserve, unguarded reserve, external reprice, external reserve. A patch that forgot the bump would let a stale writer commit.

`events`:

| Field | Role |
|---|---|
| `kind` | `COMMIT`, `EXTERNAL`, `READ`, `TOOL_CALL`, `STALE`, `FINAL` |
| `sku` | Optional. Final summaries have no sku |
| `detail` | JSON string, except `FINAL`, which is the model's one-line text |
| `mode` | `"on"` or `"off"` for agent steps. Absent on mutation-written rows |
| `runId` | Shared by the two agents in one `/run-both` |

`events` is a query of the latest 30 rows by creation time, reversed so the UI gets chronological order. There is no index. That is enough for a demo.

`sku` is optional in the schema even though the prompt lists it beside the required fields. `FINAL` and some tool calls have no sku. An empty string would show up as a fake GPU in the UI.

`list` sorts H100 then A100 so the strip does not jump when Convex returns rows in insertion order.

## Mutations

All of these are in `convex/inventory.ts`. Lookup is `withIndex("by_sku")` plus `unique()`.

`reserveGuarded({ sku, expectedVersion })`, in order, one mutation:

1. Read the row.
2. If `item.version !== expectedVersion`, throw `ConvexError`. No patch, no event. The throw aborts the transaction, which is why a `STALE` row cannot be inserted here. Anything inserted before the throw would roll back with it.
3. If `available < 1`, throw `INSUFFICIENT_INVENTORY`. Same rollback rule. Version is not bumped.
4. Patch `available - 1` and `version + 1`.
5. Insert a `COMMIT` event whose `detail` is `{ pricePerHour, available, version }`. `pricePerHour` is the price on the row at commit time, which is the price the buyer actually pays.
6. Return `{ success, sku, pricePerHour, available, version }`.

Stale payload, exact fields:

```json
{
  "code": "STALE_DEPENDENCY",
  "sku": "H100",
  "observedVersion": 1,
  "currentVersion": 2,
  "requiredAction": "READ_AND_REPLAN"
}
```

`ConvexError` is required. Returning `{ error: "STALE_DEPENDENCY" }` would commit the transaction. Callers read `error.data` on the client.

`reserveUnguarded({ sku })` is the same write with step 2 removed. It still refuses to drive `available` below 0, and it still bumps `version`. The baseline is "no freshness check," not "no invariants."

`externalReprice({ sku, pricePerHour })` changes the price and bumps `version`. It does not touch `available`. It logs `EXTERNAL`. This is the race in the demo: the H100 is still in stock, but the fact the agent used (the price, and therefore the version) is no longer true.

`externalReserve({ sku })` decrements stock, bumps `version`, logs `EXTERNAL`. The UI does not call it. It exists so a "someone else bought it" path is the same kind of version bump as a reprice.

`resetDemo` deletes every inventory row and every event, then inserts the seed above. Delete uses the current one-argument `ctx.db.delete(id)`. The two-argument form in the older docs is the previous Convex API.

`logEvent` is the side channel for rows that must survive a thrown mutation. The MCP server and the agent call it. The race test does not.

### Two COMMIT rows

A successful reserve inserts `COMMIT` inside the mutation, with no `mode` and no `runId`. The agent then inserts a second `COMMIT` with `mode` and `runId`, using the mutation's return value as `detail`.

The UI columns filter on `mode`, so they show the agent row and ignore the mutation row. The mutation row is still the transactional record: it exists even when the caller is the race test or the stampede button, which never talk to the model. Both rows count toward the latest-30 window. A normal paired run is well under 30.

`STALE` is only the agent's row, written after the mutation has already aborted.

## MCP server

`mcp/server.mjs`. Stdio. Stdout is the protocol. The server does not `console.log`.

`FRESHGUARD` is read once at process start. `"on"` registers the guarded tool. Anything else, including unset, registers the unguarded tool. The schema itself is what stops the model from omitting the version: when the flag is on, `expectedVersion` is a required argument; when it is off, the argument does not exist. One long-lived process cannot flip modes. `/run-both` spawns two processes.

Tools, exactly two:

`read_inventory`, `readOnlyHint: true`, no arguments. Returns JSON text:

```json
{
  "items": [
    { "sku": "H100", "name": "NVIDIA H100", "available": 1, "pricePerHour": 5, "version": 1 }
  ]
}
```

Document ids are not included. The agent addresses rows by sku.

`reserve_inventory` calls `reserveGuarded` or `reserveUnguarded`. Success is a normal tool result whose text is the mutation return value. Failure is `isError: true` and the `ConvexError` data as JSON text. The MCP layer catches the error on purpose. A raw exception would not arrive in the model as a structured `STALE_DEPENDENCY`.

Tool descriptions repeat the recovery rule, because a lot of MCP servers return a failure and say nothing about what to do next. The description tells the model to pass the version from the read it actually decided on, and on `STALE_DEPENDENCY` to re-read instead of retrying.

The server talks to Convex with `ConvexHttpClient`, same as the race test and the agent logger. It does not embed a second copy of the business rules.

## Agent loop

`agent/run.ts` exports `runAgent(mode, runId, opts?)`. `mode` is `"on"` or `"off"`, and that string is both the event `mode` and the child env `FRESHGUARD`.

Startup:

1. Require `ANTHROPIC_MODEL`, `ANTHROPIC_API_KEY`, and a Convex URL.
2. Spawn `node mcp/server.mjs` with the parent env plus `FRESHGUARD`. Stderr is inherited so MCP failures show in the agent terminal. Undefined env values are dropped so `spawn` does not throw.
3. `listTools`, then map each tool to an Anthropic tool. `inputSchema` from MCP is already JSON Schema and is passed through as `input_schema`.
4. Loop at most 8 model turns.

User task, fixed, not typed in the UI:

> Buy the best GPU you can afford. Budget is $6 per hour. Reserve the available GPU with the highest pricePerHour that is still at most 6.

Each turn: if the model returns no tool calls, that text is logged as `FINAL` and the loop ends. If it returns tool calls, each call is logged as `TOOL_CALL`, executed, and turned into a `tool_result`.

Logging map:

| When | `kind` |
|---|---|
| Every tool invocation | `TOOL_CALL` |
| `read_inventory` result | `READ` |
| Reserve payload with `code: STALE_DEPENDENCY` | `STALE` |
| Reserve payload with `success: true` | `COMMIT` |
| Model's closing line | `FINAL` |

After the first successful reserve, the loop does not leave tools available for another purchase. It appends one instruction to the same user message as the tool results ("the reserve is final, reply with one line, do not call tools") and makes one more model call with no tools. That line is `FINAL`.

That stop is deliberate. The unguarded success payload includes `pricePerHour: 10`. A model that then "fixes" the overspend by also buying the A100 would make the unguarded column end on the wrong GPU. The task is one GPU. The receipt uses the tool result, not the prose, so a sloppy summary cannot flip OVER BUDGET / WITHIN BUDGET. The summary is for the trace.

### The barrier

`/run-both` runs both modes on one `runId`. After each agent's first `read_inventory` tool returns, `runAgent` awaits `afterFirstRead` before the tool result is given back to the model.

The HTTP handler counts those arrivals. The second arrival calls `externalReprice({ sku: "H100", pricePerHour: 10 })` and then resolves the shared promise. Both agents then continue. The text they receive is the snapshot captured before the await, still H100 at $5 version 1. They must not be handed a fresh read here. A fresh read would show $10, the interesting write would never be attempted, and both columns would buy the A100.

The increment of the arrival counter happens before any await, so the two calls cannot both observe a count of 1. If either agent never reads, the other fails after 90 seconds instead of hanging the HTTP request.

`POST /run` with `{ "mode": "on" | "off" }` does not install the barrier and does not reprice. The manual **Reprice H100 → $10** button is the narrated version of the same world change. It is a direct Convex mutation from the browser, not an agent step.

### System prompt choices

`agent/systemPrompt.ts` is short on purpose. Each line is there because a plausible model behavior would break the side-by-side:

- Read once, then reserve. A second read after the barrier would observe $10. The unguarded agent would then also buy the A100, and the demo would show no difference.
- Re-read only on `STALE_DEPENDENCY`. That is the guarded recovery, and the only legal second read.
- Pass `expectedVersion` only when the tool schema has it. The unguarded schema rejects the extra field.
- Never repeat the same reserve after a stale error. Retrying H100 at version 1 fails again and burns the 8-turn cap.
- A GPU above $6 is no longer affordable. After the re-read, H100 at $10 must drop out, leaving A100 at $3.
- Stop after one success, even if the charged price is higher than the observed price. That is the unguarded punchline, not a cue to buy something else.

The same prompt is used for both modes. If a live run is flaky, change this text or the tool descriptions before changing the UI or the mutation.

## HTTP surface

`agent/http.ts`, `127.0.0.1:8787` only.

| Request | Behavior |
|---|---|
| `POST /run-both` | Check env, `resetDemo`, both agents, barrier reprice. Body is `{ runId, off, on }`. Each side is `{ mode, runId, summary, commits, staleCount }` |
| `POST /run` | JSON `{ "mode": "on" \| "off" }`. One agent, no reprice |
| `OPTIONS` | CORS preflight |

CORS allows `http://localhost:5173` and `http://127.0.0.1:5173`. Vite is currently started on `127.0.0.1`. A browser on `localhost` still works because both origins are listed. Other origins get `http://127.0.0.1:5173` as `Access-Control-Allow-Origin` and the browser will reject them.

The UI posts to `http://127.0.0.1:8787` directly. There is no Vite proxy.

## UI

Plain CSS, no component library. Dark background. `src/App.tsx` subscribes with `useQuery` to `list` and `events`, so inventory and the trace update without a refresh.

Top strip: one card per GPU, availability, price, and a version badge. The badge replays a short flash when `version` changes. That is the visible "the world moved" cue during the reprice.

Two columns, **Without FreshGuard** (`mode: "off"`) and **With FreshGuard** (`mode: "on"`). A `STALE` event is a red card and the sentence is built from the payload:

> Stale: you saw v1, it's now v2. Re-read and re-plan.

Other events are one row: kind plus a short label. `READ` does not dump the whole inventory JSON into the column.

The receipt is the last `COMMIT` in that column. It shows sku, price paid, budget $6, and either OVER BUDGET or WITHIN BUDGET. Price paid comes from `detail.pricePerHour`, which is the commit-time price. Comparing against the price the model thought it saw would hide the unguarded failure.

Buttons:

| Button | Effect |
|---|---|
| Run both | `POST /run-both`. Disabled while the request is in flight |
| Reprice H100 → $10 | `externalReprice` |
| Reset | `resetDemo` |
| Stampede A100 | See below |

Errors from those actions render as a line above the inventory. They are cleared by Reset and by Run both.

## Stampede

The button reads the current A100 version from the live query, then fires 20 `reserveGuarded` calls with that same `expectedVersion`. It does not go through MCP or the model. The counter is computed in the browser from the 20 results, then it re-reads inventory and reports whether any `available` is negative.

Expected outcome: 1 commit, 19 `STALE_DEPENDENCY`, stock decreased by one, never negative. This holds even when A100 has 2 units, because the first commit bumps the version and the other 19 no longer match. The point of the button is the version gate under concurrency, not "only one unit was left."

Phase 1 of `scripts/race-test.mjs` is the same experiment from Node, against a freshly reset A100 at version 1.

## Race test

`npm run test:race`. No model. Requires `dev:convex`.

Phase 1: `resetDemo`, then 20 parallel `reserveGuarded` on A100 at `expectedVersion` 1.

Measured result: 1 success, 19 stale, `other: 0`, A100 `{ available: 1, version: 2 }`, `negative: false`. Sample error payload matched the schema above.

Phase 2: an MCP client, 10 runs per mode. Each run resets, reads, reprices H100 to $10 between the read and the write, then applies a fixed policy with at most 3 attempts: choose the in-stock GPU with the highest `pricePerHour` that is still `<= 6`, using the versions from the snapshot it is currently holding. On `STALE_DEPENDENCY` it re-reads and plans again. Over budget means the commit-time price is greater than 6.

Measured result: guarded `overBudget` 0/10, every outcome A100 at $3. Unguarded `overBudget` 10/10, every outcome H100 at $10. One sample trace per mode is printed. In the unguarded trace the H100 version becomes 3, not 2: reprice is 1 → 2, and the reserve is 2 → 3.

`--phase1` stops after the first gate. The npm script does not pass that flag.

## What was verified in the browser

Against the Vite app, with Convex running:

- Reset restores H100 at 1 unit, $5, v1 and A100 at 2 units, $3, v1, and clears the trace.
- Reprice moves only the H100 to $10, v2. The A100 stays v1.
- Stampede reports `1 committed, 19 stale, inventory never negative`. A100 goes from 2 units at v1 to 1 unit at v2.
- Run both from the page reaches the agent, CORS accepts it, and a missing key is shown in the page. Inventory is not reset in that failure.

Not verified: five live `/run-both` calls with a model. There is no API key in the environment or in nearby env files. Until `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` are set and `dev:agent` is restarted, the phase 3 gate has not passed. If those runs flake, tighten `agent/systemPrompt.ts` and the tool descriptions first.

## File map

| Path | Role |
|---|---|
| `convex/schema.ts` | `inventory`, `events` |
| `convex/inventory.ts` | Queries, the four writes, `resetDemo`, `logEvent` |
| `mcp/server.mjs` | `read_inventory`, `reserve_inventory` |
| `agent/systemPrompt.ts` | Shared prompt |
| `agent/run.ts` | Claude tool loop and event logging |
| `agent/http.ts` | `/run`, `/run-both`, barrier |
| `src/main.tsx` | `ConvexProvider` |
| `src/App.tsx` | Buttons, queries, stampede |
| `src/InventoryPanel.tsx` | Live rows, version flash |
| `src/TracePanel.tsx` | Columns, stale card, receipt |
| `src/styles.css` | Demo styling |
| `scripts/race-test.mjs` | Both deterministic gates |
| `.env.local.example` | Key, model, `CONVEX_URL` |

`convex/_generated/` is produced by `convex dev`. Do not hand-edit it.

## Limits worth knowing if someone asks

- The version covers one row. It does not notice a GPU that was inserted after the read. "Best available" is only as good as the rows the agent fetched, plus the version check on the row it writes.
- Stock is still checked for both modes. Freshness is not a substitute for `available >= 1`.
- The guard is the Convex write. This demo never calls a cloud GPU provider. An external side effect would be a Convex action and would need its own re-check. It would not be inside the mutation.
- `externalReprice` does not know about agents. Any caller can bump the version. That is the point: the writer does not have to be the same agent.
- The latest-30 event window will drop older rows if a run is very noisy. The receipt only needs the latest `COMMIT` per mode.
- Anonymous local Convex is a dev deployment. It is not a production backend, and it has no public URL.
