import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const defaultJobPath = path.join(rootDir, "data", "collector-jobs", "wandsworth.osm.json");
const cachePath = path.join(rootDir, "data", ".geocode-cache.json");
const nominatimBaseUrl = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=";
const overpassUrls = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const userAgent = "LeadHelperPrototype/0.1 (+local OSM collector)";
const namePatternFlags = "i";

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== undefined) return fallback;
    throw error;
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function slugify(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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

function buildAddress(tags) {
  const parts = [
    [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" "),
    tags["addr:city"],
    tags["addr:postcode"],
  ]
    .map((part) => normalizeText(part))
    .filter(Boolean);
  return parts.join(", ");
}

function buildQuery(name, address, clusterName) {
  return [name, address, `${clusterName}, London`].filter(Boolean).join(", ");
}

function matchesPattern(value, pattern) {
  if (!pattern) return false;
  return new RegExp(pattern, namePatternFlags).test(String(value || ""));
}

function inferParentGroup(tags) {
  if (tags.brand) return "Manufacturer or branded dealership";
  if (tags.second_hand === "yes" || tags.second_hand === "only") return "Independent used dealer";
  return "Dealership";
}

function inferBrands(tags) {
  if (tags.brand) {
    return String(tags.brand)
      .split(";")
      .map((value) => normalizeText(value))
      .filter(Boolean)
      .map((value) => value.replace(/\b\w/g, (char) => char.toUpperCase()));
  }
  return [];
}

function inferRoleHint(tags) {
  if (tags.brand || tags.operator) return "Ask for showroom manager or business manager";
  return "Ask for proprietor or sales manager";
}

function inferPitch(tags) {
  if (tags.brand || tags.operator) {
    return "Premium handover, overflow, or customer-facing staging conversation near Battersea.";
  }
  return "Overflow stock, local handover use, or short-term staging conversation near Battersea.";
}

function scoreProfile(candidate, profileName) {
  if (!profileName || profileName === "all-car-dealers") {
    return { include: true, score: 0, reasons: ["Unfiltered car dealer discovery"] };
  }

  const tags = candidate.osmTags || {};
  const reasons = [];
  let score = 0;

  if (profileName === "new-car-showroom") {
    if (tags.second_hand === "only") {
      return { include: false, score: -100, reasons: ["Tagged second_hand=only"] };
    }

    if (tags.second_hand === "yes") {
      score -= 6;
      reasons.push("Tagged second_hand=yes");
    }

    if (tags.brand) {
      score += 6;
      reasons.push("Has brand tag");
    }

    if (tags.operator) {
      score += 5;
      reasons.push("Has operator tag");
    }

    if (candidate.website) {
      score += 2;
      reasons.push("Has website");
    }

    if (candidate.phone) {
      score += 1;
      reasons.push("Has phone");
    }

    if (candidate.address) {
      score += 1;
      reasons.push("Has address");
    }

    if (matchesPattern(candidate.name, "(showroom|studio|centre|center)")) {
      score += 3;
      reasons.push("Name suggests showroom");
    }

    if (matchesPattern(candidate.name, "(used|specialist|classic|sport|prestige|truck)")) {
      score -= 3;
      reasons.push("Name suggests non-franchise or specialty stock");
    }

    if (!tags.brand && !tags.operator && !candidate.website) {
      score -= 2;
      reasons.push("Missing brand, operator, and website");
    }

    return {
      include: score >= 5,
      score,
      reasons: reasons.length ? reasons : ["Scored below threshold"],
    };
  }

  return { include: true, score: 0, reasons: [`Unknown profile "${profileName}" ignored`] };
}

function dedupeKey(candidate) {
  const website = normalizeText(candidate.website).replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  const address = normalizeText(candidate.address);
  const name = normalizeText(candidate.name);
  return website || `${name}|${address}`;
}

function candidateMetadataScore(candidate) {
  let score = 0;
  if (candidate.address) score += 2;
  if (candidate.website) score += 2;
  if (candidate.phone) score += 1;
  if (candidate.brands?.length) score += 1;
  if (candidate.contactHint && candidate.contactHint !== "Decision-maker name not yet confirmed") score += 1;
  return score;
}

function mergeSameNameNearbyCandidates(candidates, maxDistanceMiles = 0) {
  if (!maxDistanceMiles) return candidates;

  const kept = [];

  candidates.forEach((candidate) => {
    const normalizedName = normalizeText(candidate.name);
    const existingIndex = kept.findIndex((item) => {
      const sameName = normalizeText(item.name) === normalizedName;
      if (!sameName) return false;
      return milesBetween(item, candidate) <= maxDistanceMiles;
    });

    if (existingIndex < 0) {
      kept.push(candidate);
      return;
    }

    const existing = kept[existingIndex];
    const winner =
      candidateMetadataScore(candidate) > candidateMetadataScore(existing)
        ? { ...existing, ...candidate }
        : { ...candidate, ...existing };
    kept[existingIndex] = winner;
  });

  return kept;
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

async function fetchOverpass(center, radiusMiles, key, value, urls = overpassUrls) {
  const radiusMeters = Math.round(radiusMiles * 1609.34);
  const query = `[out:json][timeout:25];nwr["${key}"="${value}"](around:${radiusMeters},${center.lat},${center.lng});out center tags;`;
  const errors = [];

  for (const url of urls) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "text/plain",
            "User-Agent": userAgent,
            Accept: "application/json",
          },
          body: query,
        });

        if (response.ok) {
          return response.json();
        }

        errors.push(`${url} -> ${response.status}`);
        if (![429, 502, 504].includes(response.status) || attempt === 2) {
          break;
        }
      } catch (error) {
        errors.push(`${url} -> ${error.cause?.code || error.name || "fetch-error"}`);
        if (attempt === 2) {
          break;
        }
      }

      await delay(1200 * attempt);
    }
  }

  throw new Error(`Overpass request failed after retries: ${errors.join(", ")}`);
}

function toCandidate(element, job, center) {
  const tags = element.tags || {};
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  if (typeof lat !== "number" || typeof lng !== "number") return null;

  const name = tags.name || tags.brand || `${job.clusterName} Car Dealer`;
  const address = buildAddress(tags);
  const query = buildQuery(name, address, job.clusterName);
  const distanceMiles = milesBetween(center, { lat, lng });

  return {
    id: `${element.type}-${element.id}`,
    name,
    shortName: name.split(" ")[0],
    query,
    address,
    website: tags.website || "",
    phone: tags.phone || tags["contact:phone"] || "",
    brands: inferBrands(tags),
    roleHint: inferRoleHint(tags),
    contactHint: tags.operator ? `${tags.operator} branded site; ask who handles property or overflow decisions` : "Decision-maker name not yet confirmed",
    parentGroup: inferParentGroup(tags),
    pitch: inferPitch(tags),
    radar: { left: 50, top: 50 },
    sourceType: "osm",
    sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    osmType: element.type,
    osmId: element.id,
    osmTags: tags,
    distanceMiles: Number(distanceMiles.toFixed(2)),
    intelDistance: formatDistanceMiles(distanceMiles),
    lat,
    lng,
    searchOrigin: center.label || center.query || job.clusterName,
  };
}

function getSearches(job) {
  if (Array.isArray(job.searches) && job.searches.length) {
    return job.searches.map((search, index) => ({
      label: search.label || `search-${index + 1}`,
      centerQuery: search.centerQuery,
      radiusMiles: search.radiusMiles ?? job.radiusMiles,
      tagKey: search.tagKey || job.tagKey || "shop",
      tagValue: search.tagValue || job.tagValue || "car",
    }));
  }

  return [
    {
      label: job.clusterName,
      centerQuery: job.centerQuery,
      radiusMiles: job.radiusMiles,
      tagKey: job.tagKey || "shop",
      tagValue: job.tagValue || "car",
    },
  ];
}

const jobPath = path.resolve(process.argv[2] || defaultJobPath);
const job = await readJson(jobPath);
const cache = await readJson(cachePath, {});

if (!job?.clusterId || !job?.clusterName || !job?.outputFile) {
  throw new Error(`Invalid collector job file: ${jobPath}`);
}

const searches = getSearches(job);
if (!searches.length || searches.some((search) => !search.centerQuery || !search.radiusMiles)) {
  throw new Error(`Collector job must provide center/radius fields or a valid searches[] array: ${jobPath}`);
}

const rawCandidates = [];
const failedSearches = [];
for (const search of searches) {
  console.log(`Collecting ${search.label} (${search.centerQuery}, ${search.radiusMiles} mi)`);
  try {
    const center = await geocodeQuery(search.centerQuery, cache);
    if (!center) {
      throw new Error(`Could not geocode center query: ${search.centerQuery}`);
    }

    center.label = search.label;
    center.query = search.centerQuery;

    const overpass = await fetchOverpass(
      center,
      search.radiusMiles,
      search.tagKey,
      search.tagValue,
      job.overpassUrls || overpassUrls,
    );

    rawCandidates.push(
      ...(overpass.elements || [])
        .map((element) => toCandidate(element, job, center))
        .filter(Boolean)
        .filter((candidate) => candidate.distanceMiles <= search.radiusMiles),
    );
  } catch (error) {
    const detail = error?.message || String(error);
    failedSearches.push({
      label: search.label,
      centerQuery: search.centerQuery,
      radiusMiles: search.radiusMiles,
      error: detail,
    });
    console.log(`Search failed for ${search.label}: ${detail}`);
    if (!job.continueOnSearchError) {
      throw error;
    }
  }
}

const deduped = [];
const seen = new Set();
for (const candidate of rawCandidates) {
  const key = dedupeKey(candidate);
  if (!key || seen.has(key)) continue;
  seen.add(key);
  deduped.push(candidate);
}

const filteredCandidates = deduped
  .map((candidate) => {
    const profile = scoreProfile(candidate, job.profile);
    return {
      ...candidate,
      prospectProfile: job.profile || "all-car-dealers",
      fitScore: profile.score,
      fitReasons: profile.reasons,
      prospectType: job.profile === "new-car-showroom" ? "new-car-showroom" : "car-dealer",
      isQualified: profile.include,
    };
  })
  .filter((candidate) => candidate.isQualified);

const mergedCandidates = mergeSameNameNearbyCandidates(filteredCandidates, job.sameNameMergeDistanceMiles || 0);

mergedCandidates.sort((left, right) => left.distanceMiles - right.distanceMiles || left.name.localeCompare(right.name));
mergedCandidates.forEach((candidate, index) => {
  candidate.order = index + 1;
});

const outputPath = path.resolve(path.dirname(jobPath), job.outputFile);
await writeJson(outputPath, {
  generatedAt: new Date().toISOString(),
  collector: "overpass",
  centerQuery: job.centerQuery || null,
  radiusMiles: job.radiusMiles || null,
  clusterId: job.clusterId,
  profile: job.profile || "all-car-dealers",
  searches,
  failedSearches,
  candidates: mergedCandidates,
});
await writeJson(cachePath, cache);

console.log(`Collected ${mergedCandidates.length} OSM dealership candidates for cluster "${job.clusterId}"`);
if (failedSearches.length) {
  console.log(`Collector completed with ${failedSearches.length} failed search area(s)`);
}
console.log(`Wrote ${outputPath}`);
