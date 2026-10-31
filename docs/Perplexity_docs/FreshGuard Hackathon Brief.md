# FreshGuard — Hackathon Brief
**Transactional middleware for AI agents · Convex + Claude via MCP**

---

## 1. The Problem (30-second version)

AI agents read the world ("3 GPUs available"), think for 30+ seconds, then act. If the underlying data changes during the thinking phase, the agent still holds the old observation in its context and executes a now-wrong action. This is a classic check-then-act race, and agent runtimes today provide almost nothing to catch it.

**FreshGuard:** the agent's read tool returns data + a `version`. The agent's write tool must pass that `version` back. The backend runs an atomic transaction: if the current version matches, it commits; if not, it aborts with a structured `STALE_DEPENDENCY` error that names exactly what changed — blocking the stale write and returning instructions for the agent/runtime to refresh and replan.

---

## 2. Market Validation

### The October 2026 paper: Concord (arXiv 2610.05281)

"When Agent Context Goes Stale: Incoherence in Volatile Agent Context" (Liu, Fang, Qian — submitted October 4, 2026) is the academic proof this problem is real and current.

**What it shows:**
- Agents ground reasoning in tool observations (e.g., file contents), but sources get modified by users, other agents, or external tools while the model retains only the stale copy in context.
- Their benchmark (ConcordBench-Pioneer, 40 HotpotQA-derived tasks with an injected patch-and-restore race): with **no protection**, Claude Sonnet 5 recovered the correct answer in only **20/40** tasks (50%), GLM 5.2 in **15/40** (37.5%), DeepSeek V4 Pro in **24/40** (60%). With Concord's context-coherence layer, all three hit **40/40** while using **46.4% fewer tokens** than the strongest non-oracle baseline.
- Concord's architecture: a runtime adapter tags observations with source + version, a context manager maintains bidirectional block↔source mappings, and configurable policies refresh / annotate / suppress stale context.

**What Concord does NOT do (your wedge):**
- Concord manages *context* only. It never guards the *action* — it has no transactional, compare-and-swap protection at the moment a write executes.
- The prototype only watches file writes routed through `apply_patch`; out-of-band changes need broader detection.
- Authors' own limitation: 40 tasks, local files, restricted tool harness — results don't imply workload-independent reliability.

**FreshGuard in one sentence relative to the paper:** "Concord (Oct 2026) showed agents fail on stale context in a controlled benchmark and fixed the reading side. FreshGuard addresses the writing side: observations become atomic preconditions on actions."

### ToolBench (Arcade, V2 rescan, spec baseline 2026-07-28)

Independent quality benchmark that scored **92,923 MCP servers** and analyzed **641,511 tools**:
- **70% of servers give agents no guidance when a tool call fails.**
- **83% of 29,341 destructive tools ship without safety annotations.**
- Servers that annotate their tools score 11 points higher on average.
- Grade distribution: 50,441 servers graded F; only 57 graded A+.

**Honest framing:** ToolBench does not measure stale-data failure rates — it measures server quality. Use it to show the ecosystem's error-handling is broken, which is why a *structured, actionable* conflict error (instead of a raw 400) matters.

### Punchy pitch sentences (pick 2-3)

1. "In a controlled 40-task benchmark published this month, when agents' observations went stale mid-task, unprotected agents recovered the right answer as little as 37.5% of the time — a coherence layer fixed all 40/40 tasks while using fewer tokens."
2. "Concord fixes what agents *read*. FreshGuard fixes what agents *do* — it turns every observation into an atomic precondition on the action it justified."
3. "70% of MCP servers leave agents stranded when a call fails. FreshGuard makes every conflict structured, named, and actionable."

---

## 3. Convex Implementation

### How Convex transactions actually work (verified from official docs)

- **Every mutation runs as one serializable transaction.** All reads inside see a consistent view; all writes commit together or not at all. If a mutation throws, nothing is written.
- **OCC (optimistic concurrency control):** Convex treats a transaction as a *declarative proposal* — writes commit only if every record version in the transaction's read set is still the latest. On conflict, Convex can transparently **re-run the deterministic transaction** until it succeeds ("will always eventually succeed without developer intervention"). The guarantee is **true serializability**, not just snapshot isolation.
- **`ConvexError`:** throwing it in a mutation **prevents the transaction from committing**, and any structured payload you pass to the constructor is preserved on `error.data` for the caller.
- **Constraint:** mutations must be deterministic and cannot call third-party APIs — external side effects belong in *actions*.

### The critical subtlety (know this for judge questions)

Convex's internal OCC makes each mutation serializable; it does not validate an observation obtained in an earlier tool call. FreshGuard carries that earlier observation's version into the mutation as a fixed precondition — an explicit argument that remains unchanged across any internal transaction retries. A mismatch throws a `ConvexError`, which aborts the transaction; no retry can paper over it because the check is deterministic application logic, not a read-set conflict.

**Execution trace to be able to recite:**
```text
Agent observes gpu_A @ version 7
Another mutation reserves gpu_A → version 8
Agent submits reserve(gpu_A, expectedVersion=7)
Mutation reads current version (8) → 7 !== 8 → throw STALE_DEPENDENCY
Transaction aborts; nothing written; agent receives structured error → refreshes → replans
```
Two concurrent reservations carrying version 7: at most one commits; the other receives the structured stale error.

### The mutation (illustrative starting point — requires the corresponding schema and generated types)

```ts
// convex/resources.ts
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";

export const reserveResource = mutation({
  args: {
    resourceId: v.id("resources"),
    expectedVersion: v.number(), // the version the agent OBSERVED
  },
  handler: async (ctx, { resourceId, expectedVersion }) => {
    const resource = await ctx.db.get(resourceId);
    if (resource === null) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Resource no longer exists",
      });
    }

    // --- FreshGuard precondition: observation must still be current ---
    if (resource.version !== expectedVersion) {
      throw new ConvexError({
        code: "STALE_DEPENDENCY",
        message:
          "The observation your plan was based on has changed. " +
          "Re-read the resource and replan before acting.",
        observedVersion: expectedVersion,
        currentVersion: resource.version,
      });
    }

    // --- Business validation (independent of staleness; keep honest) ---
    if (!resource.available) {
      throw new ConvexError({
        code: "ALREADY_RESERVED",
        message: "Resource is no longer available",
      });
    }

    // --- Commit: reservation + version bump are atomic ---
    await ctx.db.patch(resourceId, {
      available: false,
      reservedBy: "agent",
      version: resource.version + 1,
      updatedAt: Date.now(),
    });

    return { ok: true, version: resource.version + 1 };
  },
});
```

Rules that make this correct:
- **Every write path must bump `version`.** `_creationTime` is not a version. If any mutation can patch the resource without incrementing `version`, the guarantee is broken.
- **Throw, don't return `{error}`.** A returned object is a successful commit; only throwing aborts the transaction. (If you prefer a result-union, the conflict branch must occur before any writes.)
- **Read tools return `version` alongside data** so the agent has something to echo back:
```ts
export const getResource = query({
  args: { resourceId: v.id("resources") },
  handler: async (ctx, { resourceId }) => {
    const r = await ctx.db.get(resourceId);
    if (!r) throw new ConvexError({ code: "NOT_FOUND", message: "Not found" });
    return {
      id: r._id, name: r.name, available: r.available,
      pricePerHour: r.pricePerHour,
      version: r.version,           // <-- the dependency token
    };
  },
});
```

### The MCP layer

Expose `list_resources`, `get_resource`, `reserve_resource` as MCP tools. Key details:
- The write tool's schema *requires* `expectedVersion` — the agent cannot act without declaring what it observed.
- Map `ConvexError` payloads into the MCP tool result as a structured, model-readable error (e.g., `isError: true` with JSON content carrying `code`, `observedVersion`, `currentVersion`). Do not assume a raw exception survives to Claude intact — catch it in the tool handler and serialize it.
- In the tool *description*, tell the agent what to do on `STALE_DEPENDENCY`: "If you receive STALE_DEPENDENCY, re-read the resource and revise your plan." The error does not literally force a replan — the agent loop implements the refresh behavior, so make the instruction explicit.

### Enforcement boundary (say this before a judge asks)

- Atomicity covers **the Convex database write**. Actually provisioning a GPU at an external provider is a third-party side effect — that belongs in an *action*, and protection there is best-effort revalidation, not a guaranteed transaction.
- One record's version proves only that record is unchanged. "Reserve item X if unchanged" is the honest MVP. Note: checking all previously observed records does **not** detect a newly inserted, cheaper option — global "cheapest available" correctness would need a collection/query revision covering relevant insertions, deletions, and updates, not merely versions for the existing candidates.
- Version checks do **not** replace inventory validation — the backend must still reject unavailable resources, for both guarded and unguarded runs.

---

## 4. Competitive Landscape

| Player | What it actually does | What it lacks |
|---|---|---|
| **Concord** (arXiv, Oct 2026) | Source-linked context coherence: tags observations, detects source changes, refreshes/annotates stale context. 40/40 recovery, 46.4% fewer tokens vs strongest baseline | Context-only — no action-level guard; prototype watches file writes via `apply_patch` only |
| **Microsoft MCP firewall** (Entra Global Secure Access, preview) | Network/identity-centric policy inspection of MCP traffic: allow/block servers, tools, resources, protocol versions | Policy enforcement only — no conditional commit, no versioning, no state preconditions |
| **Cloudflare MCP authorization documentation** | OAuth authorization, token validation, scope checks for MCP servers | Declaring `requiredScopes` does not itself enforce them — handlers must check permissions; no state preconditions or version checks before effects commit |
| **selfheal-mcp** (inspected repo) | Retries with backoff + jitter, circuit breakers, call observability | Blind to semantics — retries transient failures; can duplicate non-idempotent effects; no payload repair or preconditions. Conclusions limited to this inspected repository |
| **HITL / approval flows** (OpenAI Agents SDK, design guides) | Pause run, human approves a tool call, bind approval to exact executable arguments | Approval binds to the *call*, not to the *freshness of the data behind the decision* — an approved action can still act on stale observations |

**Positioning:** FreshGuard's proposed Convex-backed MVP combines observation versions, atomic write preconditions, and actionable conflict feedback. This comparison does not establish market uniqueness. Firewalls decide *whether* a call may run; retry proxies decide *whether to repeat* a call; FreshGuard decides *whether the world the call was justified by still exists*.

---

## 5. Pitch Metaphors (for non-technical judges)

1. **"Git for agents — you can't push without pulling."** A developer who edits a file someone else has changed gets a rejected push, not a silent overwrite. FreshGuard rejects the agent's "push" when the world moved, and returns the conflicting versions.
2. **"An expiring price quote."** A stockbroker can act on a quote only while its terms still hold. FreshGuard stamps every observation with an expiry condition: act while it's valid, or re-quote.
3. **"The ticket gets re-scanned at the gate."** Seeing a free seat from across the stadium isn't permission to claim it — the gate checks again at the moment of entry. FreshGuard is the gate.

Bonus for technical audiences: **"Compare-and-swap for agents"** or **"cache coherence for AI agents — the thing distributed systems have had for decades."**

---

## 6. Demo Script (75 seconds)

1. "Claude reads GPU A as available and plans to reserve it." *(agent trace visible)*
2. From a second window, flip GPU A to unavailable. *(visible live via Convex realtime)*
3. "The old value is still sitting in Claude's context."
4. Continue the agent → **STALE_DEPENDENCY** badge flashes: `gpu_A: observed v7 → current v8`.
5. Claude refreshes, replans, reserves GPU B.
6. Close: "As agents become longer-running and more autonomous, they're effectively distributed systems. We applied the thing distributed systems have had for decades — transactions — to agent tools."

**Demo integrity rules:** the unguarded baseline must hit the same correct backend as the guarded run — observe the baseline's recovery behavior live, do not script it to fail (if the unguarded agent receives the backend conflict and recovers identically, you have demonstrated standard concurrency recovery, not a middleware advantage); rehearse the killer path 10 times; do not add features after hour 4.

---

## 7. Sources

- Concord paper (abstract): https://arxiv.org/abs/2610.05281
- Concord paper (full HTML, evaluation tables): https://arxiv.org/html/2610.05281v2
- ToolBench V2 (Arcade): https://toolbench.arcade.dev/
- Convex OCC and atomicity: https://docs.convex.dev/database/advanced/occ
- Convex application errors: https://docs.convex.dev/functions/error-handling/application-errors
- Convex mutations: https://docs.convex.dev/functions/mutation-functions
- Microsoft MCP firewall: https://learn.microsoft.com/en-us/entra/global-secure-access/how-to-configure-mcp-firewall
- Cloudflare MCP authorization: https://developers.cloudflare.com/agents/model-context-protocol/authorization/
- selfheal-mcp (retry/backoff proxy): https://github.com/carsonroell-debug/selfheal-mcp
- Approval workflow design guide: https://agentexperience.tech/insights/approval-is-a-workflow/
- Founders Inc. Night Hack event: https://luma.com/nighthack
