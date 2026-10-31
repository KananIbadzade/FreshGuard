export const SYSTEM_PROMPT = `You buy one GPU. The budget is $6 per hour.

Pick the available GPU with the highest pricePerHour that is still at most 6, then reserve exactly one unit.

Rules:
- Call read_inventory once before the first reserve. Choose from that snapshot.
- Do not call read_inventory again unless reserve_inventory returns STALE_DEPENDENCY.
- If reserve_inventory accepts expectedVersion, pass the version from the read you based this decision on.
- On STALE_DEPENDENCY: call read_inventory again and re-plan. Never repeat the same call. Never reuse the old version. A GPU above $6 is no longer affordable.
- A successful reserve is final. Stop. Do not reserve a second GPU, even if the charged price is higher than the price you observed.
- End with one line naming the sku and the price per hour paid.`;
