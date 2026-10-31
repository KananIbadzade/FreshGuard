import { api, convex, errorData } from "./lib.mjs";

const [sku, priceArg] = process.argv.slice(2);
const pricePerHour = Number(priceArg);

if (!sku || priceArg === undefined || !Number.isFinite(pricePerHour) || pricePerHour < 0) {
  console.error("usage: npm run reprice -- <SKU> <pricePerHour>   e.g. npm run reprice -- A100 9");
  process.exit(1);
}

try {
  const result = await convex.mutation(api.inventory.externalReprice, { sku, pricePerHour });
  console.log(`${result.sku} repriced to $${result.pricePerHour}/hr, now version ${result.version}`);
} catch (err) {
  console.error(JSON.stringify(errorData(err)));
  process.exit(1);
}
