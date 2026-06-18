import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const defaultJobPath = path.join(rootDir, "data", "import-jobs", "wandsworth.sample.json");
const rawDatasetPath = path.join(rootDir, "data", "dealerships.raw.sample.json");
const cachePath = path.join(rootDir, "data", ".geocode-cache.json");
const nominatimBaseUrl = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=";
const userAgent = "LeadHelperPrototype/0.1 (+local prototype importer)";

function milesBetween(left, right) {
  const earthMiles = 3958.8;
  const toRadians = (value) => (Math.PI / 180) * value;
  const dLat = toRadians(right.lat - left.lat);
  const dLon = toRadians(right.lng - left.lng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(left.lat)) * Math.cos(toRadians(right.lat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthMiles * c;
}

function formatDistanceMiles(value) {
  const rounded = value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  return `${rounded} mi`;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizedWebsite(value) {
  return normalizeText(value)
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

function splitCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const record = {};
    headers.forEach((header, index) => {
      record[header] = values[index] ?? "";
    });
    return record;
  });
}

function coerceCandidate(candidate) {
  const brands = Array.isArray(candidate.brands)
    ? candidate.brands
    : String(candidate.brands || "")
        .split("|")
        .map((value) => value.trim())
        .filter(Boolean);
  const lat = candidate.lat !== undefined && candidate.lat !== "" ? Number(candidate.lat) : undefined;
  const lng =
    candidate.lng !== undefined && candidate.lng !== ""
      ? Number(candidate.lng)
      : candidate.lon !== undefined && candidate.lon !== ""
        ? Number(candidate.lon)
        : undefined;

  return {
    ...candidate,
    order: candidate.order !== undefined && candidate.order !== "" ? Number(candidate.order) : undefined,
    lat: Number.isFinite(lat) ? lat : undefined,
    lng: Number.isFinite(lng) ? lng : undefined,
    brands,
    radar: candidate.radar || (candidate.radarLeft && candidate.radarTop ? { left: Number(candidate.radarLeft), top: Number(candidate.radarTop) } : undefined),
  };
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== undefined) return fallback;
    throw error;
  }
}

async function loadCandidates(job) {
  if (Array.isArray(job.candidates)) {
    return job.candidates.map(coerceCandidate);
  }

  if (!job.candidatesFile) {
    throw new Error("Import job must provide either candidates or candidatesFile");
  }

  const sourcePath = path.resolve(path.dirname(jobPath), job.candidatesFile);
  const sourceText = await fs.readFile(sourcePath, "utf8");
  const extension = path.extname(sourcePath).toLowerCase();

  if (extension === ".json") {
    const parsed = JSON.parse(sourceText);
    const rows = Array.isArray(parsed) ? parsed : parsed.candidates;
    if (!Array.isArray(rows)) throw new Error(`JSON candidate source must be an array or { candidates: [] }: ${sourcePath}`);
    return rows.map(coerceCandidate);
  }

  if (extension === ".csv") {
    return parseCsv(sourceText).map(coerceCandidate);
  }

  throw new Error(`Unsupported candidate source file type: ${sourcePath}`);
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function geocodeQuery(query, cache) {
  if (cache[query]) return cache[query];

  const response = await fetch(`${nominatimBaseUrl}${encodeURIComponent(query)}`, {
    headers: {
      "User-Agent": userAgent,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Nominatim request failed (${response.status}) for query: ${query}`);
  }

  const results = await response.json();
  const first = results[0] || null;
  const payload = first
    ? {
        lat: Number(first.lat),
        lng: Number(first.lon),
        displayName: first.display_name,
      }
    : null;

  cache[query] = payload;
  await delay(1100);
  return payload;
}

function getCandidateGeocode(candidate) {
  if (!Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lng)) {
    return null;
  }

  return {
    lat: candidate.lat,
    lng: candidate.lng,
    displayName: candidate.address || candidate.query || candidate.name,
  };
}

function buildRawRecord(candidate, clusterId, geocode, distanceMiles, order, sourceType) {
  return {
    id: candidate.id || slugify(candidate.name),
    name: candidate.name,
    shortName: candidate.shortName || candidate.name.split(" ")[0],
    clusterId,
    order,
    address: candidate.address || geocode.displayName,
    lat: geocode.lat,
    lng: geocode.lng,
    website: candidate.website || "",
    phone: candidate.phone || "",
    brands: candidate.brands || [],
    roleHint: candidate.roleHint || "Ask for showroom manager",
    contactHint: candidate.contactHint || "Decision-maker name not yet confirmed",
    parentGroup: candidate.parentGroup || "Dealership",
    pitch: candidate.pitch || "",
    radar: candidate.radar || { left: 50, top: 50 },
    distanceMiles: Number(distanceMiles.toFixed(2)),
    sourceType,
    sourceQuery: candidate.query,
    sourceUrl: candidate.sourceUrl || "",
    geocodedDisplayName: geocode.displayName,
  };
}

function dedupeSignature(record) {
  const website = normalizedWebsite(record.website);
  const address = normalizeText(record.address);
  const name = normalizeText(record.name);

  return {
    id: record.id || "",
    website,
    nameAddress: name && address ? `${name}|${address}` : "",
  };
}

function isSameRecord(left, right) {
  const a = dedupeSignature(left);
  const b = dedupeSignature(right);
  if (a.id && b.id && a.id === b.id) return true;
  if (a.website && b.website && a.website === b.website) return true;
  if (a.nameAddress && b.nameAddress && a.nameAddress === b.nameAddress) return true;
  return false;
}

function mergeDedupedRecords(existingRecords, importedRecords) {
  const merged = [...existingRecords];

  for (const imported of importedRecords) {
    const existingIndex = merged.findIndex((record) => isSameRecord(record, imported));
    if (existingIndex >= 0) {
      merged[existingIndex] = { ...merged[existingIndex], ...imported };
    } else {
      merged.push(imported);
    }
  }

  return merged.sort((left, right) => left.clusterId.localeCompare(right.clusterId) || left.order - right.order);
}

const jobPath = path.resolve(process.argv[2] || defaultJobPath);
const job = await readJson(jobPath);
const rawDataset = await readJson(rawDatasetPath);
const cache = await readJson(cachePath, {});

if (!job?.clusterId || !job?.centerQuery) {
  throw new Error(`Invalid import job file: ${jobPath}`);
}

const candidates = await loadCandidates(job);

const center = await geocodeQuery(job.centerQuery, cache);
if (!center) {
  throw new Error(`Could not geocode center query: ${job.centerQuery}`);
}

const included = [];
const excluded = [];

for (const candidate of candidates) {
  const geocode = getCandidateGeocode(candidate) || (candidate.query ? await geocodeQuery(candidate.query, cache) : null);
  if (!geocode) {
    excluded.push({ name: candidate.name, reason: "not-geocoded" });
    continue;
  }

  const distanceMiles = milesBetween({ lat: center.lat, lng: center.lng }, { lat: geocode.lat, lng: geocode.lng });
  if (distanceMiles > job.maxDistanceMiles) {
    excluded.push({ name: candidate.name, reason: `outside-radius (${distanceMiles.toFixed(2)} mi)` });
    continue;
  }

  included.push({
    candidate,
    geocode,
    distanceMiles,
  });
}

included.sort((left, right) => {
  const leftOrder = left.candidate.order ?? Number.POSITIVE_INFINITY;
  const rightOrder = right.candidate.order ?? Number.POSITIVE_INFINITY;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  return left.distanceMiles - right.distanceMiles;
});

const importedRecords = included.map((item, index) =>
  buildRawRecord(
    item.candidate,
    job.clusterId,
    item.geocode,
    item.distanceMiles,
    item.candidate.order ?? index + 1,
    job.sourceType || "web",
  ),
);

const retainedRecords = (rawDataset.records || []).filter(
  (record) => record.clusterId !== job.clusterId && !importedRecords.some((imported) => isSameRecord(record, imported)),
);
const mergedRecords = mergeDedupedRecords(retainedRecords, importedRecords);

const nextDataset = {
  datasetName: rawDataset.datasetName || "lead-helper-sample",
  generatedAt: new Date().toISOString().slice(0, 10),
  records: mergedRecords,
};

await writeJson(rawDatasetPath, nextDataset);
await writeJson(cachePath, cache);

console.log(`Imported ${importedRecords.length} records for cluster "${job.clusterId}" from ${jobPath}`);
if (excluded.length) {
  console.log("Excluded candidates:");
  excluded.forEach((item) => console.log(`- ${item.name}: ${item.reason}`));
}
