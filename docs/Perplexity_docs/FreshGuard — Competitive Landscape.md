# FreshGuard — Competitive Landscape

| Player | What it actually does | What it lacks |
|---|---|---|
| **Concord** (arXiv, Oct 2026) | Source-linked context coherence: tags observations, detects source changes, refreshes/annotates stale context. 40/40 recovery, 46.4% fewer tokens vs strongest baseline | Context-only — no action-level guard; prototype watches file writes via `apply_patch` only |
| **Microsoft MCP firewall** (Entra Global Secure Access, preview) | Network/identity-centric policy inspection of MCP traffic: allow/block servers, tools, resources, protocol versions | Policy enforcement only — no conditional commit, no versioning, no state preconditions |
| **Cloudflare MCP authorization documentation** | OAuth authorization, token validation, scope checks for MCP servers | Declaring `requiredScopes` does not itself enforce them — handlers must check permissions; no state preconditions or version checks before effects commit |
| **selfheal-mcp** (inspected repo) | Retries with backoff + jitter, circuit breakers, call observability | Blind to semantics — retries transient failures; can duplicate non-idempotent effects; no payload repair or preconditions |
| **HITL / approval flows** (OpenAI Agents SDK, design guides) | Pause run, human approves a tool call | Approval binds to the *call*, not to the *freshness of the data behind the decision* — an approved action can still act on stale observations |

**Positioning:** FreshGuard's proposed Convex-backed MVP combines observation versions, atomic write preconditions, and actionable conflict feedback. This comparison does not establish market uniqueness.

One line for judges:

> "Firewalls decide *whether* a call may run; retry proxies decide *whether to repeat* a call; FreshGuard decides *whether the world the call was justified by still exists*."

## Detail Per Player

### Concord (research, not a product)
- Paper: [https://arxiv.org/abs/2610.05281](https://arxiv.org/abs/2610.05281) (full HTML: [https://arxiv.org/html/2610.05281v2](https://arxiv.org/html/2610.05281v2))
- Architecture: runtime adapter (tags observations entering context, records context anchors) + context manager (bidirectional block↔source mappings, validity descriptors) + resource adapter (source versions, change detection via hooks/polling).
- Policies for stale blocks: refresh by re-reading, annotate with a stale-context warning, suppress from future prompts, or require re-read before continuing.
- Closest research overlap — FreshGuard productizes the idea and extends it from context to *actions*.

### Microsoft MCP firewall
- [Microsoft Learn documentation](https://learn.microsoft.com/en-us/entra/global-secure-access/how-to-configure-mcp-firewall)
- Preview; identity-centric security control for MCP traffic. Inspects JSON-RPC 2.0 over streamable HTTP/SSE. Allow/block servers by URL pattern, tools/resources/prompt templates per server, protocol versions.
- Does not support stdio or local MCP servers. No semantic diffs, no approval workflow, no conditional execution.

### Cloudflare MCP authorization documentation
- [Cloudflare agents documentation](https://developers.cloudflare.com/agents/model-context-protocol/authorization/)
- OAuth authorization server + resource server validation: PKCE, token validation via Service Binding, `insufficientScope` rejection, `ctx.auth`/`ctx.props`.
- Scope caveat: the page states `requiredScopes` are "advertised, not enforced" — application code must check permissions in tool handlers. Application-level permission checks are possible; the authorization layer itself does no state/version preconditions.

### selfheal-mcp (retry/backoff proxy)
- [GitHub repository](https://github.com/carsonroell-debug/selfheal-mcp)
- Wraps MCP tool calls with: exponential backoff + jitter for transient failures (5xx, timeouts, rate limits), per-target circuit breakers, call observability/metrics.
- Verified from the repository: it does **not** do semantic repair — no interpreting error messages, no fixing request payloads, no preconditions. Repository shows 6 commits, 0 stars — early/indie. Conclusions are limited to this inspected repository; other proxies were not audited.

### HITL / approval flows
- Design guide: [Approval is a workflow](https://agentexperience.tech/insights/approval-is-a-workflow/)
- OpenAI Agents SDK human-in-the-loop: [openai.github.io](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)
- The fetched design guide recommends good approval flows: show the action in plain language, exact scope, consequence/reversibility, basis, alternatives; approve-with-changes; bind approval to the exact executable operation; re-check state if the world changed while waiting.
- The guide recommends re-checking state if the world changed while waiting — but as guidance for approval implementers, not an enforced transactional mechanism. FreshGuard *enforces* a version precondition at the data layer.
