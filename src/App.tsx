import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";
import { InventoryPanel } from "./InventoryPanel";
import { TracePanel } from "./TracePanel";

const AGENT_URL = "http://127.0.0.1:8787";
const AGENT_DOWN = `Agent server not reachable at ${AGENT_URL}. Is npm run dev:agent running?`;

function messageOf(err: unknown): string {
  if (err instanceof ConvexError) return JSON.stringify(err.data);
  return err instanceof Error ? err.message : String(err);
}

async function postAgent(path: string): Promise<any> {
  const res = await fetch(`${AGENT_URL}${path}`, { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${path} failed with ${res.status}`);
  return body;
}

export function App() {
  const items = useQuery(api.inventory.list);
  const events = useQuery(api.inventory.events);
  const reprice = useMutation(api.inventory.externalReprice);
  const resetDemo = useMutation(api.inventory.resetDemo);

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);

  const finished = new Set(
    (events ?? [])
      .filter((e) => e.kind === "FINAL" && e.runId === runId)
      .map((e) => e.mode),
  );
  const running =
    pending || (runId !== null && !(finished.has("off") && finished.has("on")));
  // Falls back to the newest run so a page reload or a CLI run still shows up.
  const shownRunId =
    runId ?? (events ?? []).filter((e) => e.runId).at(-1)?.runId ?? null;

  async function runBoth() {
    setError(null);
    setPending(true);
    try {
      const body = await postAgent("/run-both");
      setRunId(body.runId);
    } catch (err) {
      setError(err instanceof TypeError ? AGENT_DOWN : messageOf(err));
    } finally {
      setPending(false);
    }
  }

  async function reset() {
    setPending(true);
    try {
      await postAgent("/reset").catch(async (err) => {
        // Without the agent server there is no run to protect, so reset Convex directly.
        if (!(err instanceof TypeError)) throw err;
        await resetDemo();
      });
      setRunId(null);
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setPending(false);
    }
  }

  async function repriceH100() {
    try {
      await reprice({ sku: "H100", pricePerHour: 10 });
    } catch (err) {
      setError(messageOf(err));
    }
  }

  return (
    <main className="app">
      <header className="app-header">
        <h1>FreshGuard</h1>
        <p className="tagline">
          Stripe idempotency keys stopped duplicate charges; FreshGuard stops
          stale ones.
        </p>
      </header>
      <div className="actions">
        <button className="primary" onClick={runBoth} disabled={running}>
          {running ? "Running…" : "Run both"}
        </button>
        <button onClick={repriceH100}>Reprice H100 → $10</button>
        <button onClick={reset} disabled={running}>
          Reset
        </button>
      </div>
      {error && <p className="error-line">{error}</p>}
      <InventoryPanel items={items} />
      <div className="columns">
        <TracePanel
          title="Without FreshGuard"
          mode="off"
          runId={shownRunId}
          events={events}
        />
        <TracePanel
          title="With FreshGuard"
          mode="on"
          runId={shownRunId}
          events={events}
        />
      </div>
    </main>
  );
}
