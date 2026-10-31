import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { InventoryPanel } from "./InventoryPanel";
import { TracePanel } from "./TracePanel";

export function App() {
  const items = useQuery(api.inventory.list);
  const events = useQuery(api.inventory.events);

  return (
    <main className="app">
      <header className="app-header">
        <h1>FreshGuard</h1>
        <p className="tagline">
          Stripe idempotency keys stopped duplicate charges; FreshGuard stops
          stale ones.
        </p>
      </header>
      <InventoryPanel items={items} />
      <div className="columns">
        <TracePanel title="Without FreshGuard" mode="off" events={events} />
        <TracePanel title="With FreshGuard" mode="on" events={events} />
      </div>
    </main>
  );
}
