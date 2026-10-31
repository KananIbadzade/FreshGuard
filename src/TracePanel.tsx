import type { Doc } from "../convex/_generated/dataModel";

const BUDGET = 6;

type Event = Doc<"events">;

function parse(detail: string): any {
  try {
    return JSON.parse(detail);
  } catch {
    return undefined;
  }
}

function label(event: Event): string {
  const data = parse(event.detail);
  switch (event.kind) {
    case "READ": {
      const items = data?.items;
      if (!Array.isArray(items)) break;
      return items
        .map((i: any) => `${i.sku} $${i.pricePerHour} v${i.version}`)
        .join(" · ");
    }
    case "TOOL_CALL": {
      const name = data?.name ?? data?.tool;
      if (!name) break;
      const input = data.input ?? data.args;
      return input && Object.keys(input).length > 0
        ? `${name} ${JSON.stringify(input)}`
        : name;
    }
    case "COMMIT":
      if (data?.pricePerHour === undefined) break;
      return `${event.sku} at $${data.pricePerHour}/hr → v${data.version}`;
    case "FINAL":
      return event.detail;
  }
  return event.detail.length > 80
    ? `${event.detail.slice(0, 80)}…`
    : event.detail;
}

function StaleCard({ event }: { event: Event }) {
  const data = parse(event.detail);
  return (
    <li className="stale-card">
      <div className="stale-title">STALE_DEPENDENCY · {data?.sku ?? event.sku}</div>
      <div>
        Stale: you saw v{data?.observedVersion}, it's now v
        {data?.currentVersion}. Re-read and re-plan.
      </div>
    </li>
  );
}

function Receipt({ commit }: { commit: Event }) {
  const raw: unknown = parse(commit.detail)?.pricePerHour;
  const price = typeof raw === "number" ? raw : undefined;
  const over = price !== undefined && price > BUDGET;
  const verdictClass =
    price === undefined ? "" : over ? " over" : " within";
  return (
    <div className={`receipt${verdictClass}`}>
      <div className="receipt-row">
        <span>GPU</span>
        <strong>{commit.sku}</strong>
      </div>
      <div className="receipt-row">
        <span>Price paid</span>
        <strong>{price === undefined ? "—" : `$${price}/hr`}</strong>
      </div>
      <div className="receipt-row">
        <span>Budget</span>
        <strong>${BUDGET}/hr</strong>
      </div>
      {price !== undefined && (
        <div className="receipt-verdict">
          {over ? "OVER BUDGET" : "WITHIN BUDGET"}
        </div>
      )}
    </div>
  );
}

export function TracePanel({
  title,
  mode,
  runId,
  events,
}: {
  title: string;
  mode: "on" | "off";
  runId: string | null;
  events: Event[] | undefined;
}) {
  const rows = (events ?? []).filter(
    (e) => e.mode === mode && e.runId === runId,
  );
  const commit = rows.filter((e) => e.kind === "COMMIT").at(-1);

  return (
    <section className={`trace trace-${mode}`}>
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="muted">No events yet.</p>
      ) : (
        <ol className="trace-list">
          {rows.map((event) =>
            event.kind === "STALE" ? (
              <StaleCard key={event._id} event={event} />
            ) : (
              <li key={event._id} className={`trace-row kind-${event.kind}`}>
                <span className="trace-kind">{event.kind}</span>
                <span className="trace-label">{label(event)}</span>
              </li>
            ),
          )}
        </ol>
      )}
      {commit && <Receipt commit={commit} />}
    </section>
  );
}
