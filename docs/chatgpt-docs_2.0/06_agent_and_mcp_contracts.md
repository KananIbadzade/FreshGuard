# FreshGuard — Agent Prompt and MCP Contracts

## MCP tools

Expose exactly two tools for the hackathon.

---

# `read_inventory`

Input:

```json
{}
```

Output:

```json
{
  "items": [
    {
      "id": "abc",
      "sku": "H100",
      "name": "NVIDIA H100",
      "available": 1,
      "pricePerHour": 5,
      "version": 7
    },
    {
      "id": "xyz",
      "sku": "A100",
      "name": "NVIDIA A100",
      "available": 2,
      "pricePerHour": 3,
      "version": 3
    }
  ]
}
```

---

# `reserve_inventory`

Input:

```json
{
  "itemId": "abc",
  "quantity": 1,
  "expectedVersion": 7
}
```

Success:

```json
{
  "success": true,
  "sku": "H100",
  "reserved": 1,
  "newVersion": 8
}
```

Stale:

```json
{
  "error": "STALE_DEPENDENCY",
  "expectedVersion": 7,
  "currentVersion": 8,
  "requiredAction": "READ_AND_REPLAN"
}
```

Do not communicate the error as a generic transient retry.

Correct:

```text
REFRESH -> REASON -> NEW ACTION
```

Incorrect:

```text
FAILED -> RETRY SAME CALL
```

---

# Suggested agent system prompt

```text
You are FreshGuard, an inventory reservation agent.

You have access to:
- read_inventory
- reserve_inventory

Rules:

1. Always read inventory before making a reservation.

2. Treat the version returned by read_inventory as a
   dependency of any decision based on that item.

3. When calling reserve_inventory, pass the exact version
   from the observation used to make your decision.

4. If reserve_inventory returns STALE_DEPENDENCY:
   - do not retry the same call,
   - do not reuse the old version,
   - call read_inventory again,
   - reconsider the user's goal using the new state,
   - make a new plan.

5. When stale state is detected, briefly explain what changed.

6. Prefer completing the user's original intent using a valid
   alternative rather than failing immediately.
```

---

# Recommended React hierarchy

```text
App
├── Header
│   ├── FreshGuard
│   └── Transactional consistency for AI agents
│
├── Demo
│   ├── InventoryPanel
│   │   ├── H100 card
│   │   ├── A100 card
│   │   ├── Simulate Other Buyer
│   │   └── Reset Demo
│   │
│   └── AgentPanel
│       ├── Chat
│       ├── ToolTrace
│       ├── FreshnessStatus
│       └── ContinueAgentButton
│
└── Footer
    └── COMMIT <=> observed_version == current_version
```

---

# Visual semantics

Use colors only for state meaning.

```text
GREEN
FRESH
SUCCESS

RED
STALE
ABORTED

AMBER
REFRESH
REPLAN
```

Versions should always remain visible.

Example:

```text
H100

Available          1
Version             7

FRESH
```

After change:

```text
Available          0
Version             8

UPDATED
```

Agent trace:

```text
OBSERVED     CURRENT

   v7     !=    v8

STALE DEPENDENCY
WRITE ABORTED
```

That visualization should explain the idea without requiring a long verbal explanation.
