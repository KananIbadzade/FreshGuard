# FreshGuard — Pitch Metaphors & Demo Script

## Three Pitch Metaphors (for non-technical judges)

1. **"Git for agents — you can't push without pulling."**
   A developer who edits a file someone else has changed gets a rejected push, not a silent overwrite. FreshGuard rejects the agent's "push" when the world moved, and returns the conflicting versions.

2. **"An expiring price quote."**
   A stockbroker can act on a quote only while its terms still hold. FreshGuard stamps every observation with an expiry condition: act while it's valid, or re-quote.

3. **"The ticket gets re-scanned at the gate."**
   Seeing a free seat from across the stadium isn't permission to claim it — the gate checks again at the moment of entry. FreshGuard is the gate.

**Bonus lines for technical audiences:**
- "Compare-and-swap for agents."
- "Cache coherence for AI agents — a concurrency-control idea distributed systems have had for decades."

## The Honest Demo Sequence

The core demonstration is:

```text
read v7 → another update commits v8 → stale write rejected → agent refreshes → valid reservation commits
```

## 75-Second Demo Script

1. "Claude reads GPU A as available and plans to reserve it." *(agent trace visible)*
2. From a second window, flip GPU A to unavailable. *(visible live via Convex realtime)*
3. "The old value is still sitting in Claude's context."
4. Continue the agent → **STALE_DEPENDENCY** badge flashes: `gpu_A: observed v7 → current v8`.
5. Claude refreshes, replans, reserves GPU B.
6. Close: "As agents become longer-running and more autonomous, they're effectively distributed systems. We applied the thing distributed systems have had for decades — transactions — to agent tools."

## Demo Integrity Rules

- The unguarded baseline must hit the **same correct backend** as the guarded run. Observe the baseline's recovery behavior live — do not script it to fail. If the unguarded agent receives the backend conflict and recovers identically, you have demonstrated standard concurrency recovery, not a middleware advantage.
- Rehearse the killer path 10 times in a row.
- Do not add features after hour 4 of the sprint.

## Event Facts (Night Hack by Founders, Inc.)

- Event page: [https://luma.com/nighthack](https://luma.com/nighthack)
- Friday, October 30 · 4:00–11:00 PM PDT · San Francisco (address after registration). 312 attending.
- Schedule: 4:15 PM check-in + team formation · 5:00–10:00 PM build (5 hours) · 10:00 PM exhibition + judging (live demos, no slides) · 11:00 PM close.
- Solo or teams up to 4; every member applies individually. Existing code, models, and hardware welcome — judges evaluate the work completed during the sprint.
- Sponsors: **Firecrawl** (web search/extraction), **Bolt** (AI app builder), **Convex** (realtime backend), **Anthropic** ($50 API credits per builder; $10,000 in prize credits for top teams).

## Companion Files

- `01-market-validation.md` — Concord paper + ToolBench stats + pitch sentences
- `02-convex-implementation.md` — OCC mechanics, mutation code, MCP layer, enforcement boundary
- `03-competitive-landscape.md` — players, gaps, positioning
- `../freshguard-brief.md` — the complete combined brief
