# FreshGuard — Market Validation

## The Problem (30-second version)

AI agents read the world ("3 GPUs available"), think for 30+ seconds, then act. If the underlying data changes during the thinking phase, the agent still holds the old observation in its context and executes a now-wrong action. This is a classic **check-then-act race**, and agent runtimes today provide almost nothing to catch it.

**FreshGuard's solution:** the agent's read tool returns data + a `version`. The agent's write tool must pass that `version` back. The backend runs an atomic transaction: if the current version matches, it commits; if not, it aborts with a structured `STALE_DEPENDENCY` error that names exactly what changed — blocking the stale write and returning instructions for the agent/runtime to refresh and replan.

---

## The October 2026 Paper: Concord

**"When Agent Context Goes Stale: Incoherence in Volatile Agent Context"** — Yingying Liu, Junzhou Fang, Chenxiong Qian. Submitted October 4, 2026.
- Abstract: [https://arxiv.org/abs/2610.05281](https://arxiv.org/abs/2610.05281)
- Full paper (HTML): [https://arxiv.org/html/2610.05281v2](https://arxiv.org/html/2610.05281v2)

### What it shows

- Agents ground reasoning in tool observations (e.g., file contents), but sources get modified by users, other agents, or external tools while the model retains only the stale copy in its context window.
- Existing agent runtimes provide little support for notifying the model that a previously observed fact has become stale — agents reuse outdated observations and make incorrect claims about current state.

### Evaluation (ConcordBench-Pioneer)

- 40 tasks derived from the multi-hop subset of HotpotQA, materialized as files in a local workspace. Each task **starts with mutated evidence in the workspace**; the agent reads the mutated span, and the race controller then **restores the original workspace** — so the agent's trajectory may retain the mutated evidence even though the workspace again matches the gold answer.
- Default tools: `grep`, `glob`, `read_file`, `answer`. Three frontier models evaluated: **Claude Sonnet 5, GLM 5.2, DeepSeek V4 Pro**.

| Model | Naive (no protection) | Concord |
|---|---:|---:|
| Claude Sonnet 5 | 20/40 recovered (50%) | **40/40 (100%)** |
| GLM 5.2 | 15/40 recovered (37.5%) | **40/40 (100%)** |
| DeepSeek V4 Pro | 24/40 recovered (60%) | **40/40 (100%)** |

- Concord used **46.4% fewer tokens** than the strongest non-oracle baseline (the "Diff" baseline), while also needing fewer steps.
- Baselines compared: Naive (leave prior observations unchanged), Alert (append a notice that a path was modified), Diff (report restored patches as before/after diffs), Oracle (no race injected; upper bound = 40/40).

### What Concord does NOT do (FreshGuard's wedge)

- Concord manages **context only** — it never guards the **action**. It has no transactional, compare-and-swap protection at the moment a write executes.
- The prototype only watches file writes routed through `apply_patch`; out-of-band changes require broader change detection.
- Authors' own stated limitation: 40 tasks, local files, a restricted tool harness, and a controlled patch-and-restore race — results do not imply workload-independent reliability.

**One sentence relative to the paper:** "Concord (Oct 2026) showed agents fail on stale context in a controlled benchmark and fixed the reading side. FreshGuard addresses the writing side: observations become atomic preconditions on actions."

---

## ToolBench (Arcade, V2)

Independent quality benchmark for MCP servers: [https://toolbench.arcade.dev/](https://toolbench.arcade.dev/)

- Spec baseline: 2026-07-28. **92,923 MCP servers scored, 641,511 tools analyzed, 2,855 integrations covered.**
- **70% of servers give agents no guidance when a tool call fails.**
- **83% of 29,341 destructive tools ship without safety annotations.**
- Servers that annotate their tools score 11 points higher on average.
- Grade distribution: 50,441 servers graded F; only 57 graded A+.

**Honest framing (important):** ToolBench does **not** measure stale-data failure rates — it measures server quality. Use it to show the ecosystem's error-handling is broken, which is why a *structured, actionable* conflict error (instead of a raw 400) matters.

---

## Punchy Pitch Sentences (pick 2-3)

1. "In a controlled 40-task benchmark published this month, when agents' observations went stale mid-task, unprotected agents recovered the right answer as little as 37.5% of the time — a coherence layer fixed all 40/40 tasks while using fewer tokens."
2. "Concord fixes what agents *read*. FreshGuard fixes what agents *do* — it turns every observation into an atomic precondition on the action it justified."
3. "70% of MCP servers leave agents stranded when a call fails. FreshGuard makes every conflict structured, named, and actionable."

---

## Sources

- Concord paper (abstract): [https://arxiv.org/abs/2610.05281](https://arxiv.org/abs/2610.05281)
- Concord paper (full HTML, evaluation tables): [https://arxiv.org/html/2610.05281v2](https://arxiv.org/html/2610.05281v2)
- ToolBench V2 (Arcade): [https://toolbench.arcade.dev/](https://toolbench.arcade.dev/)
