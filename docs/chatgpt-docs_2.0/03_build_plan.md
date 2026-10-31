# FreshGuard — 5-Hour Build Plan

## Priority order

```text
1. Transaction guard
2. Deterministic demo
3. Visible error
4. Agent recovery
5. Appearance
```

---

# T-5:00 -> T-4:45
## Project setup — 15 min

Suggested structure:

```text
freshguard/
├── convex/
│   ├── schema.ts
│   └── inventory.ts
│
├── src/
│   ├── App.tsx
│   ├── InventoryPanel.tsx
│   ├── AgentPanel.tsx
│   └── main.tsx
│
├── agent/
│   ├── server.ts
│   ├── mcp.ts
│   └── systemPrompt.ts
│
└── package.json
```

Install:

```bash
npm create vite@latest
npm install
npm install convex
npm install @anthropic-ai/sdk
npm install @modelcontextprotocol/server
npm install @modelcontextprotocol/client
npm install zod
```

Then:

```bash
npx convex dev
```

Do not style yet.

---

# T-4:45 -> T-3:45
## Core transaction mechanism — 60 min

Implement:

```text
schema
-> seed
-> read
-> externalReserve
-> reserveWithVersion
-> STALE_DEPENDENCY
```

Before touching Claude, prove this manually.

### Test A

```text
read H100
version=1

reserve expectedVersion=1

SUCCESS
```

### Test B

Reset.

```text
read H100
version=1

externalReserve H100
version becomes 2

reserve expectedVersion=1

STALE_DEPENDENCY
```

If this is not working after one hour:

> Do not build anything else until it works.

---

# T-3:45 -> T-3:10
## Dashboard — 35 min

Build:

```text
InventoryPanel
```

Use Convex React hooks:

```ts
useQuery(...)
useMutation(...)
```

Display:

```text
name
available
price
version
```

Add:

```text
[ Simulate Other Buyer ]
[ Reset Demo ]
```

Do not build:

- login
- settings
- navigation
- account management

---

# T-3:10 -> T-2:25
## MCP tools — 45 min

Expose exactly two tools:

```text
read_inventory
reserve_inventory
```

No more.

### read_inventory

Input:

```json
{}
```

Output:

```json
{
  "items": [
    {
      "id": "...",
      "sku": "H100",
      "available": 1,
      "pricePerHour": 5,
      "version": 7
    }
  ]
}
```

### reserve_inventory

Input:

```json
{
  "itemId": "...",
  "quantity": 1,
  "expectedVersion": 7
}
```

Success:

```json
{
  "success": true,
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

Do not return a generic `retry=true`.

Recovery is:

```text
refresh + replan
```

---

# T-2:25 -> T-1:35
## Claude agent — 50 min

System prompt rules:

```text
You are the FreshGuard reservation agent.

Rules:

1. Before making a reservation, call read_inventory.

2. Every reservation must use the exact version returned
   by read_inventory as expectedVersion.

3. If reserve_inventory returns STALE_DEPENDENCY,
   NEVER retry the same reservation with the same version.

4. Call read_inventory again.

5. Re-evaluate the user's goal using the new state.

6. Only then make another reservation attempt.

Explain stale recovery briefly to the user.
```

Do not spend a long time prompt-engineering.

---

# T-1:35 -> T-1:00
## Split-screen UI + trace — 35 min

Right panel should show execution cards.

Example:

```text
READ OK

H100
available: 1
version: 7
```

Then:

```text
PLAN

Reserve H100
based on version 7
```

Then:

```text
STALE_DEPENDENCY

observed 7
current 8

Action blocked.
```

Then:

```text
REFRESH
```

Then:

```text
REPLAN

H100 unavailable.
Selecting A100.
```

Then:

```text
COMMIT OK
```

---

# T-1:00 -> T-0:40
## Make the race deterministic — 20 min

Add a demo barrier:

```text
Agent has planned action

[ Continue Agent ]
```

Internal state machine:

```text
IDLE
-> READING
-> PLANNED
-> WAITING_FOR_EXECUTION
-> WRITING
-> STALE
-> REFRESHING
-> REPLANNING
-> SUCCESS
```

Do not rely on Claude taking long enough naturally.

---

# T-0:40 -> T-0:20
## Test 10 times — 20 min

Only two scenarios matter.

### Scenario A — normal control

```text
read
-> no external change
-> reserve H100
-> success
```

### Scenario B — FreshGuard

```text
read H100 @7
-> external change
-> H100 @8
-> stale write rejected
-> reread
-> select A100
-> success
```

---

# T-0:20 -> T-0:00
## Demo prep — 20 min

Prepare:

- browser already open
- Convex running
- agent server running
- API keys loaded
- data reset
- zoom readable
- terminal hidden
- slides ready
- backup screenshots/video
- large Reset Demo button

---

# Hard scope cuts

Cut first:

```text
animations
themes
authentication
audit history
multiple users
multiple resource types
fancy MCP abstractions
deployment
mobile layout
charts
settings
```

Never cut:

```text
explicit version
atomic check
STALE_DEPENDENCY
refresh
replan
visible demo
```

---

# Success criteria

You are finished when this works reliably 10/10 times:

```text
1. Reset.

2. Ask:
   "Reserve H100, otherwise A100."

3. Agent reads H100 @ v1.

4. Pause.

5. Click "Simulate Other Buyer."

6. H100 becomes:
   available=0
   version=2.

7. Continue.

8. FreshGuard visibly rejects:
   expected=1
   current=2.

9. Claude refreshes.

10. Claude chooses A100.

11. A100 reservation succeeds.

12. UI updates live.
```
