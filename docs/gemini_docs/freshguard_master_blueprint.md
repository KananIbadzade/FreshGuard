# FreshGuard: Master Research, Architecture & Build Blueprint

**Hackathon Strategy, Technical Specs, & Startup Pitch Documentation**

---

## 1. Executive Summary & Pitch Strategy

* **The One-Liner:** "Databases have cache coherence. Distributed systems have consistency models. AI agents currently don't. FreshGuard is transactional middleware for AI agents."
* **The "Why Now?":** We are moving from "Read-Only Agents" (summarizing text) to "Read-Write Agents" (booking resources, altering code, sending emails). As agents take autonomous actions, the delay between reading the state and executing an action creates massive vulnerability to race conditions.
* **The Problem (Check-Then-Act Race Condition):** An agent reads a state (e.g., "3 GPUs available"). It spends 10-60 seconds planning, using other tools, or waiting for user approval. During this time, the world state changes (e.g., 0 GPUs available). The agent, blind to the real-world change, executes a destructive or invalid action based on its stale context.
* **The Solution (Optimistic Concurrency for Agents):** FreshGuard forces agents to pass a `version_id` (or hash) with any state-changing action. If the backend data has changed since the agent read it, the transaction aborts atomically. FreshGuard returns a `STALE_DEPENDENCY` error, forcing the agent to re-read the state and replan its action.

---

## 2. Technical Architecture & Schemas

### The Core Mechanism
FreshGuard relies on **Optimistic Concurrency Control (OCC)**. Instead of locking the database so nobody else can use it (Pessimistic Concurrency), we let everyone read. But before a write is committed, we check if the version has changed. 

### 1. Convex Backend Schema (Conceptual)
You will need a schema that tracks versions on every document. 
```typescript
// Convex Schema conceptually requires:
export default defineSchema({
  inventory: defineTable({
    name: v.string(),
    price: v.number(),
    status: v.string(), // "available", "reserved"
    version_id: v.number(), // CRITICAL: Increments on every change
  }),
});
```

### 2. Convex Mutation Logic (The "Guard")
The write function must be an atomic transaction in Convex.
```typescript
// Pseudo-logic for the reservation mutation
export const reserveItem = mutation({
  args: { itemId: v.id("inventory"), expectedVersion: v.number() },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    
    // THE FRESHGUARD CHECK:
    if (item.version_id !== args.expectedVersion) {
      throw new Error(`STALE_DEPENDENCY: Resource changed from version ${args.expectedVersion} to ${item.version_id}. Please re-read and replan.`);
    }
    
    // If safe, execute change and increment version
    await ctx.db.patch(args.itemId, { 
      status: "reserved", 
      version_id: item.version_id + 1 
    });
  }
});
```

### 3. MCP Server Tool Definitions
Your MCP Server will expose exactly two tools to Claude:
1. `read_inventory`: 
   * **Returns:** JSON array of items, including their `id` and `version_id`.
2. `reserve_gpu`: 
   * **Args:** `itemId` (string), `version_id` (number).
   * **Behavior:** Calls the Convex mutation. If it catches a `STALE_DEPENDENCY` error, it *does not* crash. It returns that exact error string back to Claude's context window.

---

## 3. Strict 5-Hour Hackathon Timeline

**Hour 1: Boilerplate & Infrastructure (5:00 PM - 6:00 PM)**
* Initialize Vite + React project.
* Initialize Convex (`npx convex dev`).
* Initialize basic MCP TypeScript server template.
* **Goal:** A blank React app connecting to Convex, and Claude successfully connecting to a dummy MCP tool.

**Hour 2: The Backend & Transaction Guard (6:00 PM - 7:00 PM)**
* Write the `schema.ts` with the `version_id` field.
* Write the `read` query and the `reserve` mutation with the version-checking logic.
* Manually test the mutation in the Convex dashboard (simulate a version mismatch to ensure it throws the error).

**Hour 3: The MCP Server (7:00 PM - 8:00 PM)**
* Connect the MCP server to the Convex backend using Convex's HTTP/Node client.
* Wire up `read_inventory` and `reserve_gpu`.
* Add an artificial `sleep(10)` (10-second delay) inside the `reserve_gpu` tool right *before* it hits Convex. This gives you time to manually sabotage the database during the live demo.

**Hour 4: The Frontend Dashboard (8:00 PM - 9:00 PM)**
* Build a clean, simple React UI showing the Convex inventory.
* Add an "Edit Price" button so you can manually change data on the fly.
* Keep it visually distinct (Left side: The World / Right side: Claude chat).

**Hour 5: Demo Rehearsal & Pitch Polish (9:00 PM - 10:00 PM)**
* Run through the demo flow 5 times.
* Ensure Claude reliably handles the error and replans without hallucinating.
* Draft your 3-minute spoken pitch. 

---

## 4. Minute-by-Minute Live Demo Script

* **[0:00 - 0:30] The Setup:** "Agents are acting on stale data. We built FreshGuard to give them cache coherence. On the left is our real-time inventory. On the right is our agent."
* **[0:30 - 1:00] The Prompt:** Type: *"I have a budget of \$5. Reserve the cheapest available GPU for 2 hours."*
* **[1:00 - 1:30] The Sabotage:** Claude reads the DB. It sees Node A is \$2/hr. It says "Thinking..." (hitting your 10s sleep). **ACTION:** You quickly click the UI and change Node A's price to \$10. "The real world just changed while the agent was thinking," you tell the judges.
* **[1:30 - 2:00] The Block:** Claude attempts the reservation. The screen flashes a terminal log: `Convex Transaction Aborted: Version Mismatch`. 
* **[2:00 - 2:30] The Recovery (The Magic):** Claude receives the `STALE_DEPENDENCY` error. Without human intervention, you watch Claude say: *"My data is stale. Let me re-read."* It sees the new \$10 price, realizes it breaks the \$5 budget, and successfully reserves Node B instead. 
* **[2:30 - 3:00] The Conclusion:** "Without FreshGuard, the agent would have blown the budget or crashed. Tomorrow, FreshGuard is an SDK any MCP developer can use to guarantee transactional safety."

---

## 5. Expanded Real-World Use Cases (For the Pitch)

If judges ask, "Why not just use normal database locks?", use these examples to explain why hard locks break multi-agent systems, and why Optimistic Concurrency is better:

1. **The DevOps Auto-Remediation (Jira + AWS):** 
   * An agent reads a P1 Jira ticket. It spends 2 minutes querying AWS logs to find the fix. 
   * Meanwhile, a human engineer manually resolves the incident and closes the Jira ticket. 
   * Without FreshGuard: The agent pushes the AWS fix and re-opens the Jira ticket, overwriting the human's notes.
   * With FreshGuard: The agent's final write to Jira is blocked because the ticket version changed. It re-reads, sees it's closed, and halts safely.
2. **The Collaborative Coding Assistant (Cursor/GitHub):**
   * Agent reads `utils.ts` to implement a new feature.
   * A teammate pushes a hotfix to `utils.ts` on the same branch.
   * Without FreshGuard: Agent overwrites the hotfix because it applies line-changes to the old file state.
   * With FreshGuard: GitHub/MCP rejects the PR/Commit, forcing the agent to rebase its context.

---

## 6. Deep Dive FAQ & Defensibility

**Q: Is this just productizing the Concord paper?**
A: Yes and no. The Concord paper (*When Agent Context Goes Stale*, Oct 2026) proved the *problem* exists and proposed a framework for linking observations to sources. However, Concord focuses on *context management* (refreshing the prompt). FreshGuard introduces the **transactional write guard**. We are moving the safety mechanism from the prompt layer down to the execution layer via Convex atomic mutations.

**Q: How does the future SDK actually work?**
A: Developers won't need to write `version_id` checks manually. They will run `npm install freshguard-mcp`. They wrap their MCP server: `const safeServer = withFreshGuard(myMcpServer)`. The SDK intercepts outgoing read tools, caches the hashes, and intercepts incoming write tools to validate the hashes against the backend before letting the tool execute. 

---

## 7. AI Prompts for Code Generation

**Prompt 1: Generate the Convex Backend (Give to Cursor/Claude)**
> "Write a complete Convex `schema.ts` and `mutations.ts` for an inventory system. The schema must include `id`, `name`, `price`, `status`, and `version_id`. I need a `readInventory` query. Most importantly, I need a `reserveItem` mutation that takes an `itemId` and an `expectedVersion`. The mutation MUST check if the current database `version_id` matches `expectedVersion`. If it doesn't, throw a Javascript Error with the text 'STALE_DEPENDENCY'. If it matches, update the status to 'reserved' and increment `version_id` by 1."

**Prompt 2: Generate the MCP Tool (Give to Cursor/Claude)**
> "Write an MCP Server tool in TypeScript called `reserve_gpu`. It should take `itemId` and `version_id` as arguments. Inside the tool, make an HTTP call to my Convex mutation `reserveItem`. Crucially, wrap this in a try/catch. If the Convex mutation throws an error containing 'STALE_DEPENDENCY', DO NOT crash the MCP server. Instead, return a formatted string back to the LLM saying: 'Action failed: STALE_DEPENDENCY. The underlying data has changed. Please use read_inventory to get the latest state and try again.' Include a 10-second `await sleep(10000)` at the very beginning of the tool execution to simulate slow LLM thinking time for my demo."