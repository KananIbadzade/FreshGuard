# FreshGuard

Stripe idempotency keys stopped duplicate charges; FreshGuard stops stale ones.

FreshGuard is an MCP safety layer on a Convex inventory. An agent reads a row, thinks, then writes. The write sends back the `version` it saw. If that row changed, the mutation rejects the write with `STALE_DEPENDENCY` and the agent re-reads instead of retrying the same call.

## What is in this repo

- `convex/` — inventory rows and the version check (`reserveGuarded` / `reserveUnguarded`)
- `mcp/` — stdio MCP server (`freshguard-mcp`): `read_inventory` and `reserve_inventory`
- `agent/` — local HTTP agent the demo UI calls
- `src/` — Vite demo UI (Run both, reprice, reset)
- [docs/reference/DECISIONS.md](docs/reference/DECISIONS.md) — schema, error payload, and what shipped

`FRESHGUARD=on` requires `expectedVersion` on the reserve. `FRESHGUARD=off` is the same tools without the check, so a stale write can still commit. Unset is the same as `off`.

The demo seed is an H100 at $5/hr and an A100 at $3/hr. **Run both** starts a guarded agent and an unguarded one. During the pause after the first read, **Reprice H100 → $10** bumps that row's version. The unguarded reserve commits at $10. The guarded reserve is rejected; the agent reads again and takes the A100.

How to run it, and the MCP config for Cursor or Claude Desktop, is in the [README](README.md).

## References

- [When Agent Context Goes Stale…](https://arxiv.org/abs/2610.05281)
- [Real Faults in Model Context Protocol (MCP) Software…](https://arxiv.org/abs/2603.05637) (also published in ACM TOSEM)
