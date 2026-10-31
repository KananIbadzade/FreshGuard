# FreshGuard Research & Hackathon Brief

**FreshGuard prevents AI agents from acting on facts that are no longer true.**

FreshGuard is a transactional consistency pattern for MCP-based agents. A read returns application data plus a version identifier. A later state-changing tool call must provide the version that the agent observed. The backend atomically checks that the current version still matches before committing.

```text
READ -> data + version_id
           |
           v
       Claude reasons
           |
           v
WRITE(expected_version)
           |
           v
current == expected ?
   yes -> COMMIT
   no  -> STALE_DEPENDENCY -> REFRESH -> REPLAN
```

## Suggested stack

- Anthropic Claude
- MCP (Model Context Protocol)
- Convex
- TypeScript / Node.js
- Optional Next.js demo UI

## Core invariant

```text
COMMIT <=> V_observed = V_current
```

## Files

- `01_market_validation.md`
- `02_convex_implementation.md`
- `03_competitive_landscape.md`
- `04_pitch_metaphors.md`
- `05_demo_pitch_architecture.md`
- `06_sources.md`
- `FreshGuard_Complete_Brief.md`
