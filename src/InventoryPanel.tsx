import { useRef } from "react";
import type { Doc } from "../convex/_generated/dataModel";

export function InventoryPanel({
  items,
}: {
  items: Doc<"inventory">[] | undefined;
}) {
  if (items === undefined) {
    return <section className="inventory muted">Loading inventory…</section>;
  }
  if (items.length === 0) {
    return (
      <section className="inventory muted">
        No inventory. Press Reset to seed the demo.
      </section>
    );
  }

  return (
    <section className="inventory">
      {items.map((item) => (
        <GpuCard key={item.sku} item={item} />
      ))}
    </section>
  );
}

function GpuCard({ item }: { item: Doc<"inventory"> }) {
  const firstVersion = useRef(item.version);
  const changed = useRef(false);
  if (item.version !== firstVersion.current) changed.current = true;

  return (
    <article className="gpu-card" data-sku={item.sku}>
      <header>
        <span className="gpu-sku">{item.sku}</span>
        <span
          key={item.version}
          className={changed.current ? "version-badge flash" : "version-badge"}
        >
          v{item.version}
        </span>
      </header>
      <div className="gpu-name">{item.name}</div>
      <div className="gpu-price">${item.pricePerHour}/hr</div>
      <div className={item.available > 0 ? "gpu-stock" : "gpu-stock out"}>
        {item.available} available
      </div>
    </article>
  );
}
