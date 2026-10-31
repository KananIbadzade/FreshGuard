# FreshGuard — User Stories and 2-Minute Demo

## User Story 1 — Normal reservation

> As a user, I want the agent to reserve inventory when the state it observed is still current.

Acceptance:

```text
Read version = 7
Current version = 7
-> commit
```

---

## User Story 2 — Detect stale state

> As a user, I want the system to prevent an agent from acting on outdated information.

Acceptance:

```text
Read version = 7
Current version = 8
-> no write
-> STALE_DEPENDENCY
```

---

## User Story 3 — Recover intelligently

> As a user, I want the agent to refresh and replan instead of blindly retrying the same stale action.

Correct:

```text
STALE_DEPENDENCY
        |
        v
read_inventory()
        |
        v
new state
        |
        v
new reasoning
        |
        v
new write
```

Incorrect:

```text
STALE_DEPENDENCY
        |
        v
retry(H100, version=7)
```

---

## User Story 4 — Make the race visible

> As a judge, I want to clearly see why the first action was rejected.

UI should show:

```text
OBSERVED VERSION       CURRENT VERSION

       7        !=            8

               STALE
```

---

# 2-Minute Live Demo Script

## Screen layout

Left 55%:

```text
LIVE WORLD STATE
------------------------

H100 GPU
Available       1
Price           $5/hr
Version         7

[ Simulate Other Buyer ]

A100 GPU
Available       2
Price           $3/hr
Version         3
```

Right 45%:

```text
FRESHGUARD AGENT
------------------------

Chat

Agent trace

READ
PLAN
WRITE
STALE
REFRESH
REPLAN
SUCCESS
```

Header:

```text
FreshGuard
Transactional consistency for AI agents
```

---

## 0:00-0:15 — Explain the problem

Say:

> "AI agents read the world, spend time reasoning, and then act. But the world can change while they're thinking."

Do not explain Convex yet.

---

## 0:15-0:30 — Show current state

Point to:

```text
H100
Available: 1
Version: 7
```

Say:

> "This H100 is currently available, and the state is version seven."

---

## 0:30-0:45 — Give Claude the task

Prompt:

```text
Reserve one H100 GPU.

If the H100 is no longer available,
reserve one A100 instead.
```

Agent trace:

```text
READ OK

H100
available = 1
version = 7

Plan:
Reserve H100.
```

The app should now pause at:

```text
PLAN READY
Waiting to execute...

[ Continue Agent ]
```

You can say:

> "I'm pausing here just to make the concurrency race visible."

---

## 0:45-1:00 — Change reality

Before clicking Continue:

Click:

```text
SIMULATE OTHER BUYER
```

Left side changes:

```text
H100

Available
1 -> 0

Version
7 -> 8
```

Say:

> "Another user just reserved it. But Claude doesn't know that yet. Version seven is still in its context."

---

## 1:00-1:15 — Trigger stale write

Click:

```text
Continue Agent
```

Agent attempts:

```text
reserve_item(
    H100,
    expectedVersion=7
)
```

Show:

```text
+----------------------------+
|  STALE_DEPENDENCY          |
|                            |
|  observed: 7               |
|  current:  8               |
|                            |
|  WRITE ABORTED             |
+----------------------------+
```

This is the core demo moment.

---

## 1:15-1:35 — Recovery

Agent trace:

```text
STALE_DEPENDENCY

-> refresh required

read_inventory()

H100
available = 0
version = 8

A100
available = 2
version = 3

-> replan

Reserve A100
```

Then:

```text
reserve_item(
    A100,
    expectedVersion=3
)

SUCCESS
```

Left UI:

```text
A100
available 2 -> 1
version   3 -> 4
```

---

## 1:35-1:50 — Explain

Say:

> "We didn't ask Claude to remember to double-check. The database made the stale decision impossible to commit."

---

## 1:50-2:00 — Finish

Say:

> "Firewalls ask whether an agent is allowed to act. FreshGuard asks whether the facts that justified the action are still true."

Stop there.
