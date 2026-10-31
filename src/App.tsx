import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { InventoryPanel } from "./InventoryPanel";

export function App() {
  const items = useQuery(api.inventory.list);

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
    </main>
  );
}
