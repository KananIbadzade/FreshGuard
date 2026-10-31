# FreshGuard - Market Validation

## The stale-context problem

A relevant October 2026 paper is **"When Agent Context Goes Stale: Incoherence in Volatile Agent Context."**

Source: https://arxiv.org/abs/2610.05281

The problem:

1. An agent calls a tool.
2. The tool returns an observation.
3. That observation enters the model context.
4. The underlying source changes.
5. The old observation remains in context.
6. The model continues reasoning from stale state.

Example:

```text
Agent reads:
FREE_SHIPPING_THRESHOLD = $100

Another process changes:
FREE_SHIPPING_THRESHOLD = $50

Agent still reasons from $100.
```

The source of truth is correct; the model's local snapshot is stale.

## Concord

Concord associates observations with source metadata such as:

```text
source
version
selector/range
```

When the source changes, Concord can refresh, invalidate, annotate, or remove stale observations and force a re-read.

Conceptually:

```text
source changes
  -> stale observation detected
  -> model context repaired
  -> model reasons again
```

## ConcordBench-Pioneer

The paper introduces a controlled benchmark specifically designed to create stale-observation races.

Reported naive recovery:

| Model | Naive recovery |
|---|---:|
| Claude Sonnet 5 | 20/40 - 50% |
| GLM 5.2 | 15/40 - 37.5% |
| DeepSeek V4 Pro | 24/40 - 60% |

With Concord:

| Model | Concord |
|---|---:|
| Claude Sonnet 5 | 40/40 |
| GLM 5.2 | 40/40 |
| DeepSeek V4 Pro | 40/40 |

The paper also reports **46.4% fewer tokens than the strongest evaluated non-oracle baseline**.

### Important caveat

Do not say:

> AI agents fail 50% of the time in production.

Safer:

> In a controlled benchmark designed specifically to test stale-context races, naive agents recovered correctly only 37.5-60% of the time across the tested models.

## Alerts alone are not enough

Reported Claude results:

```text
Naive:   50%
Alert:   65%
Diff:    90%
Concord: 100%
```

Reported GLM results:

```text
Naive:   37.5%
Alert:   57.5%
Diff:    77.5%
Concord: 100%
```

Product implication:

> Do not rely on the model remembering to check freshness. Infrastructure should enforce it.

## FreshGuard vs Concord

Concord protects the **reasoning context**.

FreshGuard protects the **commit boundary**.

```text
READ
GPU A = available
version = 17

LLM thinks

state changes
version = 18

WRITE
expectedVersion = 17

17 != 18

STALE_DEPENDENCY
-> ABORT
-> REFRESH
-> REPLAN
```

Positioning:

> Concord keeps the model's worldview coherent.

> FreshGuard makes stale context incapable of authorizing a commit.

## ToolBench / MCP ecosystem evidence

ToolBench does **not** publish a stale-data failure-rate statistic that should be presented as one.

Source: https://toolbench.arcade.dev/insights

The previously referenced ecosystem figures were:

- 92,923 MCP servers analyzed
- 641,511 tools analyzed
- 70.2% / 64,106 servers provide no useful recovery guidance when tool calls fail
- 29,341 destructive tools
- roughly 83% of destructive tools lack safety annotations

Use this as adjacent evidence about weak MCP recovery/safety semantics, not as a stale-context benchmark.

## Pitch-ready sentences

> **Agents don't operate on live state - they operate on snapshots copied into their context. In ConcordBench, naive frontier agents recovered correctly from deliberately stale observations only 37.5-60% of the time, while coherence enforcement reached 40/40 across all three tested models.**

> **Meanwhile, ToolBench's analysis of more than 92,000 MCP servers found that 70.2% provide agents no recovery guidance when a tool fails, and most destructive tools lack safety annotations.**

> **FreshGuard moves correctness out of the prompt and into the transaction: if the facts an agent acted on are no longer true, the write simply cannot commit.**
