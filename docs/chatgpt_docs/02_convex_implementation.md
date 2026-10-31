# FreshGuard - Convex Implementation

## Why Convex fits

Convex provides useful primitives for FreshGuard:

- atomic mutations
- consistent transaction reads
- optimistic concurrency control (OCC)

Sources:

- https://docs.convex.dev/database/advanced/occ
- https://docs.convex.dev/understanding/overview

## The key architectural idea

Normal database OCC protects work inside one transaction:

```text
Transaction starts
READ GPU
WRITE GPU
```

An agent workflow is usually:

```text
READ

20 seconds of Claude reasoning

WRITE
```

You do **not** want to keep a transaction open while Claude thinks.

FreshGuard carries a transaction precondition across that gap:

```text
READ -> version 17

Claude thinks

WRITE(expectedVersion=17)
```

The write mutation performs a fresh read inside a new atomic Convex transaction.

## Minimal model

```ts
gpus: {
  name: "GPU-A",
  available: true,
  price: 4.25,
  version: 17
}
```

For the hackathon, increment an explicit integer version on every meaningful state change:

```text
version += 1
```

## Read tool

```ts
export const getGpu = query({
  args: {
    gpuId: v.id("gpus"),
  },

  handler: async (ctx, args) => {
    const gpu = await ctx.db.get(args.gpuId);

    if (!gpu) {
      throw new Error("GPU_NOT_FOUND");
    }

    return {
      id: gpu._id,
      name: gpu.name,
      available: gpu.available,
      price: gpu.price,
      version_id: gpu.version,
    };
  },
});
```

MCP-visible result:

```json
{
  "gpu": {
    "id": "gpu_a",
    "available": true,
    "price": 4.25
  },
  "version_id": 17
}
```

## Guarded write mutation

```ts
import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";

export const reserveGpu = mutation({
  args: {
    gpuId: v.id("gpus"),
    expectedVersion: v.number(),
  },

  handler: async (ctx, args) => {
    const gpu = await ctx.db.get(args.gpuId);

    if (!gpu) {
      throw new ConvexError({
        code: "RESOURCE_NOT_FOUND",
      });
    }

    if (gpu.version !== args.expectedVersion) {
      throw new ConvexError({
        code: "STALE_DEPENDENCY",
        expectedVersion: args.expectedVersion,
        currentVersion: gpu.version,
        recovery: "Refresh the resource and replan before retrying.",
      });
    }

    if (!gpu.available) {
      throw new ConvexError({
        code: "RESOURCE_UNAVAILABLE",
      });
    }

    await ctx.db.patch(gpu._id, {
      available: false,
      version: gpu.version + 1,
    });

    return {
      success: true,
      newVersion: gpu.version + 1,
    };
  },
});
```

## Safety invariant

```text
WRITE(resource, expectedVersion)

commits ONLY IF

currentVersion(resource) == expectedVersion
```

Or:

```text
COMMIT <=> V_observed = V_current
```

Otherwise:

```text
ABORT -> STALE_DEPENDENCY -> REFRESH -> REPLAN
```

## Avoid TOCTOU

Do **not** do this:

```text
MCP server:
1. query Convex version
2. compare version in Node
3. call a separate mutation
```

That creates a classic Time Of Check -> Time Of Use race.

Correct pattern:

```text
MCP write tool
    -> ONE Convex mutation
        -> read current state
        -> compare versions
        -> perform write
```

All consistency-sensitive logic stays in the same transaction.

## Race behavior

Suppose the mutation initially sees:

```text
version = 17
```

and the expected version is 17.

If a conflicting write changes the relevant document, Convex OCC detects the conflict rather than silently committing inconsistent state.

On re-evaluation, FreshGuard sees:

```text
currentVersion = 18
expectedVersion = 17
```

and returns:

```text
STALE_DEPENDENCY
```

Related docs:

- https://docs.convex.dev/database/advanced/occ
- https://docs.convex.dev/error

## Claude stays outside the transaction

Architecture:

```text
+--------------------------+
| Claude                   |
+------------+-------------+
             | MCP
             v
+--------------------------+
| FreshGuard MCP Server    |
| read_resource            |
| reserve_resource         |
+------------+-------------+
             |
             v
+--------------------------+
| Convex                   |
| query -> observation     |
| mutation -> guarded write|
+--------------------------+
```

Mutation docs:

https://docs.convex.dev/functions/mutation-functions

## MCP stale-dependency response

```json
{
  "error": "STALE_DEPENDENCY",
  "resource": "gpu_a",
  "observed_version": 17,
  "current_version": 18,
  "retryable": false,
  "required_action": "Call get_gpu again and replan."
}
```

`retryable: false` matters.

You want:

```text
REFRESH -> REASON -> NEW ACTION
```

not:

```text
FAILED -> RETRY SAME CALL
```

## Multi-resource dependency sets

If time allows, support multiple dependencies:

```json
{
  "dependencies": [
    {
      "resource": "gpu_a",
      "version": 17
    },
    {
      "resource": "budget",
      "version": 9
    },
    {
      "resource": "reservation_policy",
      "version": 22
    }
  ]
}
```

The action depends on:

```text
GPU available        @17
budget sufficient    @9
policy permits it    @22
```

FreshGuard validates every dependency before commit:

```text
17 == 17 OK
9  == 10 STALE
22 == 22 OK

ABORT
STALE_DEPENDENCY: budget
```

This makes FreshGuard look like a general **agent dependency validation protocol**, not just a row-version trick.
