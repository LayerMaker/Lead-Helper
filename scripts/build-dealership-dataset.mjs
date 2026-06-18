import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const rawPath = path.join(rootDir, "data", "dealerships.raw.sample.json");
const normalizedPath = path.join(rootDir, "src", "data", "dealerships.normalized.json");

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatDistanceMiles(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "";
  const rounded = value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  return `${rounded} mi`;
}

function normalizeRecord(record) {
  return {
    id: record.id || slugify(record.name),
    clusterId: record.clusterId,
    order: record.order,
    name: record.name,
    shortName: record.shortName || record.name.split(" ")[0],
    address: record.address,
    roleHint: record.roleHint || "Ask for showroom manager",
    contactHint: record.contactHint || "Decision-maker name not yet confirmed",
    parentGroup: record.parentGroup || "Dealership",
    brands: Array.isArray(record.brands) ? record.brands : [],
    phone: record.phone || "",
    website: record.website || "",
    pitch: record.pitch || "",
    location: [record.lat, record.lng],
    radar: record.radar || { left: 50, top: 50 },
    intelDistance: record.intelDistance || formatDistanceMiles(record.distanceMiles),
    sourceType: record.sourceType || "unknown",
    sourceQuery: record.sourceQuery || "",
  };
}

const raw = JSON.parse(await fs.readFile(rawPath, "utf8"));
const normalized = raw.records
  .map(normalizeRecord)
  .sort((left, right) => left.clusterId.localeCompare(right.clusterId) || left.order - right.order);

await fs.mkdir(path.dirname(normalizedPath), { recursive: true });
await fs.writeFile(normalizedPath, `${JSON.stringify(normalized, null, 2)}\n`);

console.log(`Wrote ${normalized.length} normalized dealership records to ${normalizedPath}`);
