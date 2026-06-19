import { buffer } from "@turf/buffer";
import { centerOfMass } from "@turf/center-of-mass";
import { convex } from "@turf/convex";
import { featureCollection, lineString, point } from "@turf/helpers";
import dealershipsData from "../data/dealerships.normalized.json";
import discoveryData from "../../data/candidates/london-newcar.discovery.json";

export const STORAGE_KEY = "lead-helper-shell-v1";
export const STATE_VERSION = 2;
const defaultOpenRouterApiKey = "";
const defaultOcrModel = import.meta.env.VITE_OPENROUTER_OCR_MODEL || "qwen/qwen-vl-plus";
const defaultEmailModel = import.meta.env.VITE_OPENROUTER_EMAIL_MODEL || "openai/gpt-5-mini";

export const baseClusters = [
  { id: "chiswick", name: "Chiswick", colorClass: "territory-amber", routeTime: "76 min" },
  { id: "battersea", name: "Battersea", colorClass: "territory-mint", routeTime: "48 min" },
  { id: "wandsworth", name: "Wandsworth", colorClass: "territory-rose", routeTime: "52 min" },
  { id: "brentford", name: "Brentford", colorClass: "territory-teal", routeTime: "36 min" },
];
export const clusters = baseClusters;
const acceptedClusterPalette = ["territory-amber", "territory-mint", "territory-rose", "territory-teal"];

const LONDON_FALLBACK_CENTER = [51.4838, -0.2153];
const POINT_BUFFER_KM = 0.45;
const LINE_BUFFER_KM = 0.32;
const POLYGON_BUFFER_KM = 0.22;

export const dealerships = dealershipsData;
export const discoveryDataset = discoveryData;
export const discoveryProspects = (discoveryData.candidates || []).map((candidate, index) => ({
  ...candidate,
  order: candidate.order ?? index + 1,
  location: [candidate.lat, candidate.lng],
}));

export const outcomeRules = {
  "Met manager": {
    scoreDelta: 3,
    status: "Met manager",
    adminActions: ["Log manager contact for report card"],
  },
  Interested: {
    scoreDelta: 4,
    status: "Interested",
    adminActions: ["Raise lead priority on dashboard"],
  },
  "Needs email": {
    scoreDelta: 1,
    createAction: { type: "email", title: "Send follow-up email", duePreset: { offsetDays: 0, hour: 16, minute: 30 } },
    createDraft: true,
    adminActions: ["Create follow-up email task", "Attach Battersea site pack"],
  },
  "Follow-up required": {
    scoreDelta: 1,
    createAction: { type: "call", title: "Follow-up call", duePreset: { offsetDays: 2, hour: 10, minute: 30 } },
    adminActions: ["Create follow-up call task"],
  },
  "Site walk booked": {
    scoreDelta: 6,
    status: "Site walk booked",
    createAction: { type: "site_walk", title: "Confirm site walk", duePreset: { offsetDays: 3, hour: 10, minute: 30 } },
    createDraft: true,
    adminActions: ["Add viewing slot to report card", "Create site walk confirmation"],
  },
  "Deferred to decision maker": {
    scoreDelta: 2,
    createAction: { type: "decision", title: "Request decision-maker intro", duePreset: { offsetDays: 1, hour: 11, minute: 0 } },
    createDraft: true,
    adminActions: ["Create owner / decision-maker chase"],
  },
  "Card captured": {
    scoreDelta: 1,
    createAction: { type: "verify_contact", title: "Verify OCR contact details", duePreset: { offsetDays: 0, hour: 18, minute: 0 } },
    adminActions: ["Queue OCR contact verification"],
  },
  "Not suitable": {
    scoreDelta: -8,
    status: "Not suitable",
    adminActions: ["Suppress route priority and mark report row closed"],
  },
};

export const emailTypeCatalog = [
  "Standard follow-up",
  "Site details follow-up",
  "Decision-maker intro request",
  "Site walk confirmation",
  "Contact verification",
  "Polite close-out",
];

export const visitOutcomeOptions = [
  "Met manager",
  "Interested",
  "Needs email",
  "Follow-up required",
  "Deferred to decision maker",
  "Card captured",
  "Site walk booked",
  "Not suitable",
];

export const emailIntentCatalog = [
  {
    id: "instant-follow-up",
    label: "Instant follow-up",
    emailType: "Standard follow-up",
    templateBlock:
      "It was great connecting with you today, I really appreciate your time. I just thought I would follow up with a quick email while the conversation is fresh.",
    promptHint: "Send a same-day thank-you note after an in-person showroom visit.",
  },
  {
    id: "brochure-to-follow",
    label: "Brochure to follow",
    emailType: "Site details follow-up",
    templateBlock:
      "When I am back at my desk, I will send over the brochure along with more detailed information on the Battersea site.",
    promptHint: "Promise that the brochure and site information will follow shortly.",
  },
  {
    id: "check-back-in",
    label: "Check back in",
    emailType: "Standard follow-up",
    templateBlock:
      "Before I check back in with you, I wanted to keep the email thread open so the details are easy to pick up.",
    promptHint: "Keep the lead warm and create an easy thread for the next touchpoint.",
  },
  {
    id: "decision-maker",
    label: "Decision maker",
    emailType: "Decision-maker intro request",
    templateBlock:
      "If it makes sense to include the decision-maker or wider team, please feel free to forward this on and I can send the relevant details through to them as well.",
    promptHint: "Politely ask for the relevant property or senior decision-maker to be included.",
  },
  {
    id: "team-member-absent",
    label: "Team member absent",
    emailType: "Decision-maker intro request",
    templateBlock:
      "I understand the relevant team member was unavailable today, so I am happy to pick this back up when they are back in.",
    promptHint: "Acknowledge that the right person was unavailable without making the email sound stalled.",
  },
  {
    id: "before-site-walk",
    label: "Before site walk",
    emailType: "Site walk confirmation",
    templateBlock:
      "Ahead of the site walk, I will send over the key access notes and site information so the visit is useful from the outset.",
    promptHint: "Warmly bridge the conversation before an agreed or likely site walk.",
  },
  {
    id: "send-site-pack",
    label: "Send site pack",
    emailType: "Site details follow-up",
    templateBlock:
      "I can send across a short site pack covering access, frontage, layout, and how the space could work for overflow stock, handovers, or local staging.",
    promptHint: "Offer a concise Battersea site pack with the most relevant commercial property details.",
  },
  {
    id: "polite-close-out",
    label: "Polite close-out",
    emailType: "Polite close-out",
    templateBlock:
      "If the site is not quite right for your current requirements, no problem at all. I am happy to close the loop for now and pick it back up if things change.",
    promptHint: "Politely close the conversation while leaving the door open.",
  },
];

export const defaultVisitOutcomes = ["Met manager", "Interested", "Needs email", "Follow-up required"];
export const dealershipIdAliases = {
  "joe-macari-wandsworth": "way-791359685",
  "hni-motors": "way-821683850",
  "tz-cars": "node-3488395622",
  "balham-cars-london": "node-8779669268",
  "genesis-studio-battersea": "way-333778999",
};

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function canonicalDealershipId(dealershipId) {
  return dealershipIdAliases[dealershipId] || dealershipId;
}

function padNumber(value) {
  return String(value).padStart(2, "0");
}

function weekdayIndexFromLabel(label) {
  return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(String(label || "").toLowerCase());
}

function parseClockTime(value = "") {
  const match = String(value).match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
}

function parseHumanDueText(dueText, reference = new Date()) {
  const text = String(dueText || "").trim();
  if (!text) return "";

  const working = new Date(reference);
  working.setSeconds(0, 0);

  if (/^today/i.test(text)) {
    const time = parseClockTime(text) || { hour: 17, minute: 0 };
    working.setHours(time.hour, time.minute, 0, 0);
    return working.toISOString();
  }

  if (/^tomorrow/i.test(text)) {
    const time = parseClockTime(text) || { hour: 10, minute: 30 };
    working.setDate(working.getDate() + 1);
    working.setHours(time.hour, time.minute, 0, 0);
    return working.toISOString();
  }

  const daysMatch = text.match(/^In\s+(\d+)\s+days?/i);
  if (daysMatch) {
    working.setDate(working.getDate() + Number(daysMatch[1]));
    working.setHours(10, 30, 0, 0);
    return working.toISOString();
  }

  const weekdayMatch = text.match(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)(?:\s+(\d{1,2}:\d{2}))?/i);
  if (weekdayMatch) {
    const targetDay = weekdayIndexFromLabel(weekdayMatch[1]);
    const time = parseClockTime(weekdayMatch[2]) || { hour: 10, minute: 30 };
    const delta = (targetDay - working.getDay() + 7) % 7 || 7;
    working.setDate(working.getDate() + delta);
    working.setHours(time.hour, time.minute, 0, 0);
    return working.toISOString();
  }

  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? "" : fallback.toISOString();
}

function buildDueAtFromPreset(preset = {}, reference = new Date()) {
  const working = new Date(reference);
  working.setSeconds(0, 0);
  working.setDate(working.getDate() + (preset.offsetDays || 0));
  working.setHours(preset.hour ?? 17, preset.minute ?? 0, 0, 0);
  return working.toISOString();
}

function startOfDay(date) {
  const clone = new Date(date);
  clone.setHours(0, 0, 0, 0);
  return clone;
}

export function toDateTimeLocalValue(isoValue) {
  if (!isoValue) return "";
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}T${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`;
}

export function fromDateTimeLocalValue(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function formatActionDueLabel(action, reference = new Date()) {
  const dueAt = action?.dueAt || parseHumanDueText(action?.dueText, reference);
  if (!dueAt) return action?.dueText || "No due date";

  const dueDate = new Date(dueAt);
  if (Number.isNaN(dueDate.getTime())) return action?.dueText || "No due date";

  const now = new Date(reference);
  const today = startOfDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dueDay = startOfDay(dueDate);
  const timeText = `${padNumber(dueDate.getHours())}:${padNumber(dueDate.getMinutes())}`;

  if (dueDate < now) return `Overdue - ${dueDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} ${timeText}`;
  if (dueDay.getTime() === today.getTime()) return `Today ${timeText}`;
  if (dueDay.getTime() === tomorrow.getTime()) return `Tomorrow ${timeText}`;
  return `${dueDate.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })} ${timeText}`;
}

export function normalizeActionRecord(action, reference = new Date()) {
  const dueAt = action?.dueAt || parseHumanDueText(action?.dueText, reference);
  return {
    ...action,
    dueAt,
    dueText: formatActionDueLabel({ ...action, dueAt }, reference),
  };
}

export function getPendingActionBuckets(actions, reference = new Date()) {
  const now = new Date(reference);
  const today = startOfDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const normalized = (actions || [])
    .map((action) => normalizeActionRecord(action, reference))
    .filter((action) => action.status === "pending")
    .sort((left, right) => String(left.dueAt || "").localeCompare(String(right.dueAt || "")) || left.title.localeCompare(right.title));

  return normalized.reduce(
    (groups, action) => {
      const dueDate = action.dueAt ? new Date(action.dueAt) : null;
      if (!dueDate || Number.isNaN(dueDate.getTime())) {
        groups.upcoming.push(action);
        return groups;
      }
      if (dueDate < now) {
        groups.overdue.push(action);
        return groups;
      }
      if (startOfDay(dueDate).getTime() === today.getTime()) {
        groups.today.push(action);
        return groups;
      }
      if (startOfDay(dueDate).getTime() === tomorrow.getTime()) {
        groups.upcoming.push(action);
        return groups;
      }
      groups.upcoming.push(action);
      return groups;
    },
    { overdue: [], today: [], upcoming: [] },
  );
}

export const initialState = {
  version: STATE_VERSION,
  selectedClusterId: "wandsworth",
  currentDealershipId: "hni-motors",
  acceptedClusters: [],
  parkedDiscoveryAreaIds: [],
  manualDealerships: [],
  settings: {
    ocrProvider: "openrouter",
    openRouterApiKey: defaultOpenRouterApiKey,
    ocrModel: defaultOcrModel,
    emailProvider: "openrouter",
    emailModel: defaultEmailModel,
    emailGenerationMode: "template",
    workEmail: "",
    preferredSendMode: "mailto",
    notificationsEnabled: false,
    notificationLeadMinutes: 30,
  },
  dealerships: [
    { id: "fast-cars-chiswick", status: "Interested", leadScore: 78, nextAction: "Send site details today" },
    { id: "chiswick-motor-house", status: "Follow-up due", leadScore: 64, nextAction: "Call Dealer Principal before 11:00" },
    { id: "west4-auto-centre", status: "Met manager", leadScore: 52, nextAction: "Capture card and confirm owner contact" },
    { id: "battersea-motors", status: "Follow-up due", leadScore: 71, nextAction: "Call Simon after 2pm" },
    { id: "joe-macari-wandsworth", status: "Interested", leadScore: 72, nextAction: "Send prestige summary pack" },
    { id: "hni-motors", status: "Follow-up due", leadScore: 67, nextAction: "Call after morning trade window" },
    { id: "tz-cars", status: "Met manager", leadScore: 58, nextAction: "Verify decision-maker contact" },
    { id: "balham-cars-london", status: "Visited - no contact", leadScore: 46, nextAction: "Revisit on Balham pass" },
    { id: "genesis-studio-battersea", status: "Interested", leadScore: 76, nextAction: "Send Battersea summary pack" },
    { id: "brentford-auto-centre", status: "Not visited", leadScore: 35, nextAction: "Visit on Brentford route day" },
  ],
  visits: [
    {
      id: "visit-seed-1",
      dealershipId: "battersea-motors",
      clusterId: "battersea",
      outcomes: ["Deferred to decision maker", "Needs email", "Follow-up required"],
      note: "Simon named as property lead after 2pm.",
      createdAt: "2026-06-15 10:45",
    },
    {
      id: "visit-seed-2",
      dealershipId: "genesis-studio-battersea",
      clusterId: "wandsworth",
      outcomes: ["Met manager", "Interested", "Needs email"],
      note: "Requested short Battersea summary and viewing options.",
      createdAt: "2026-06-15 14:10",
    },
    {
      id: "visit-seed-3",
      dealershipId: "west4-auto-centre",
      clusterId: "chiswick",
      outcomes: ["Card captured", "Follow-up required"],
      note: "Operations contact likely but email needs verification.",
      createdAt: "2026-06-16 09:05",
    },
    {
      id: "visit-seed-4",
      dealershipId: "hni-motors",
      clusterId: "wandsworth",
      outcomes: ["Met manager", "Follow-up required"],
      note: "Manager asked for a later callback after trade movement.",
      createdAt: "2026-06-16 11:05",
    },
  ],
  actions: [
    {
      id: "action-seed-1",
      dealershipId: "fast-cars-chiswick",
      title: "Send site details",
      type: "email",
      dueAt: "2026-06-18T16:30:00.000Z",
      dueText: "Today",
      priority: "high",
      status: "pending",
      note: "Met Matthew, wants loading/access pack.",
    },
    {
      id: "action-seed-2",
      dealershipId: "battersea-motors",
      title: "Call Simon after 2pm",
      type: "call",
      dueAt: "2026-06-18T14:00:00.000Z",
      dueText: "Today 14:00",
      priority: "high",
      status: "pending",
      note: "Owner absent; Simon handles property lead.",
    },
    {
      id: "action-seed-3",
      dealershipId: "genesis-studio-battersea",
      title: "Send Battersea summary pack",
      type: "email",
      dueAt: "2026-06-18T17:00:00.000Z",
      dueText: "Today",
      priority: "medium",
      status: "pending",
      note: "Studio follow-up requested with short summary and viewing options.",
    },
    {
      id: "action-seed-5",
      dealershipId: "hni-motors",
      title: "Call after morning trade window",
      type: "call",
      dueAt: "2026-06-18T11:30:00.000Z",
      dueText: "Today 11:30",
      priority: "medium",
      status: "pending",
      note: "Manager asked for a later callback after forecourt activity.",
    },
    {
      id: "action-seed-4",
      dealershipId: "chiswick-motor-house",
      title: "Call Dealer Principal",
      type: "call",
      dueAt: "2026-06-19T10:30:00.000Z",
      dueText: "Tomorrow 10:30",
      priority: "medium",
      status: "pending",
      note: "Dealer Principal unavailable on last visit.",
    },
  ],
  emailDrafts: [
    {
      id: "draft-seed-1",
      dealershipId: "fast-cars-chiswick",
      emailType: "Site details follow-up",
      subject: "Battersea site details",
      body: "Hi Matthew, thanks again for the time earlier today. I am sending over the Battersea site details we discussed, including access notes, yard dimensions, and how the unit could work for overflow stock or local handovers. If useful, I can arrange a short walk-through this week.",
      status: "draft",
      createdAt: "2026-06-16 09:12",
    },
    {
      id: "draft-seed-2",
      dealershipId: "genesis-studio-battersea",
      emailType: "Site details follow-up",
      subject: "Battersea summary pack",
      body: "Thanks for your time today. I am sending over a short Battersea summary with the key details on access, frontage, and how the site could support overflow stock, premium customer handovers, or short-term staging.",
      status: "draft",
      createdAt: "2026-06-15 14:22",
    },
  ],
  contacts: [
    {
      id: "contact-seed-1",
      dealershipId: "fast-cars-chiswick",
      name: "Matthew Carter",
      role: "Sales Manager",
      email: "matthew@fastcarschiswick.co.uk",
      phone: "020 8742 1101",
      source: "scrape",
    },
    {
      id: "contact-seed-2",
      dealershipId: "battersea-motors",
      name: "Simon Reed",
      role: "Property Lead",
      email: "simon@batterseamotors.co.uk",
      phone: "020 7223 0102",
      source: "visit",
    },
    {
      id: "contact-seed-3",
      dealershipId: "genesis-studio-battersea",
      name: "Studio Team",
      role: "Business Specialist",
      email: "custsupport@contact.genesis.com",
      phone: "",
      source: "web",
    },
  ],
  media: [
    {
      id: "media-seed-1",
      dealershipId: "west4-auto-centre",
      type: "business_card",
      status: "ocr-pending",
      createdAt: "2026-06-16 09:05",
    },
  ],
};

export function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

export function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
}

function toGeoPoint(location, properties = {}) {
  return point([location[1], location[0]], properties);
}

export function getDistanceMilesBetweenPoints(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== 2 || right.length !== 2) return Number.POSITIVE_INFINITY;

  const earthMiles = 3958.8;
  const toRadians = (value) => (Math.PI / 180) * value;
  const dLat = toRadians(right[0] - left[0]);
  const dLon = toRadians(right[1] - left[1]);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(left[0])) * Math.cos(toRadians(right[0])) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthMiles * c;
}

function routeSortFromReference(stops, referenceLocation) {
  const remaining = [...stops];
  const ordered = [];
  let currentLocation = referenceLocation || getCenterForLocations(stops.map((stop) => stop.location).filter(Boolean));

  while (remaining.length) {
    remaining.sort((left, right) => {
      const leftDistance = getDistanceMilesBetweenPoints(currentLocation, left.location);
      const rightDistance = getDistanceMilesBetweenPoints(currentLocation, right.location);
      return leftDistance - rightDistance || left.name.localeCompare(right.name);
    });

    const nextStop = remaining.shift();
    ordered.push({
      ...nextStop,
      routeDistanceMiles: getDistanceMilesBetweenPoints(currentLocation, nextStop.location),
    });
    currentLocation = nextStop.location;
  }

  return ordered.map((stop, index) => ({
    ...stop,
    routeOrder: index + 1,
  }));
}

function toLeafletCoordinates(geoCoordinates) {
  return geoCoordinates.map(([lng, lat]) => [lat, lng]);
}

function polygonArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[(index + 1) % ring.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2);
}

function getLargestOuterRing(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") {
    return geometry.coordinates[0] || [];
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates
      .map((polygonCoordinates) => polygonCoordinates[0] || [])
      .sort((left, right) => polygonArea(right) - polygonArea(left))[0] || [];
  }
  return [];
}

function getCenterForLocations(locations) {
  if (!locations.length) return LONDON_FALLBACK_CENTER;
  if (locations.length === 1) return locations[0];

  const center = centerOfMass(featureCollection(locations.map((location) => toGeoPoint(location))));
  return [center.geometry.coordinates[1], center.geometry.coordinates[0]];
}

function getCoverageFeatureForLocations(locations) {
  if (!locations.length) return null;

  if (locations.length === 1) {
    return buffer(toGeoPoint(locations[0]), POINT_BUFFER_KM, { units: "kilometers", steps: 24 });
  }

  const geoLine = lineString(locations.map(([lat, lng]) => [lng, lat]));

  if (locations.length === 2) {
    return buffer(geoLine, LINE_BUFFER_KM, { units: "kilometers", steps: 24 });
  }

  const hull = convex(featureCollection(locations.map((location) => toGeoPoint(location))));
  if (!hull) {
    return buffer(geoLine, LINE_BUFFER_KM, { units: "kilometers", steps: 24 });
  }

  return buffer(hull, POLYGON_BUFFER_KM, { units: "kilometers", steps: 24 }) || hull;
}

export function getCoveragePolygonForLocations(locations) {
  const coverageFeature = getCoverageFeatureForLocations(locations);
  const ring = getLargestOuterRing(coverageFeature?.geometry);
  if (!ring.length) return [];

  const leafletCoordinates = toLeafletCoordinates(ring);
  if (leafletCoordinates.length > 1) {
    const [firstLat, firstLng] = leafletCoordinates[0];
    const [lastLat, lastLng] = leafletCoordinates[leafletCoordinates.length - 1];
    if (firstLat === lastLat && firstLng === lastLng) {
      return leafletCoordinates.slice(0, -1);
    }
  }
  return leafletCoordinates;
}

function getTopBrands(prospects, max = 3) {
  const counts = new Map();
  prospects.forEach((prospect) => {
    (prospect.brands || []).forEach((brand) => {
      counts.set(brand, (counts.get(brand) || 0) + 1);
    });
  });
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, max)
    .map(([brand]) => brand);
}

export const discoveryAreas = Object.values(
  discoveryProspects.reduce((groups, prospect) => {
    const key = prospect.searchOrigin || "London Discovery";
    if (!groups[key]) groups[key] = [];
    groups[key].push(prospect);
    return groups;
  }, {}),
).map((prospects) => {
  const first = prospects[0];
  const locations = prospects.map((prospect) => prospect.location).filter(Boolean);
  const averageFitScore = prospects.reduce((total, prospect) => total + (prospect.fitScore || 0), 0) / prospects.length;
  return {
    id: slugify(first.searchOrigin || first.name),
    name: first.searchOrigin || first.name,
    count: prospects.length,
    center: getCenterForLocations(locations),
    polygon: getCoveragePolygonForLocations(locations),
    averageFitScore: Number(averageFitScore.toFixed(1)),
    topBrands: getTopBrands(prospects),
  };
}).sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));

export function getDiscoveryArea(areaId) {
  return discoveryAreas.find((area) => area.id === areaId);
}

export function getDiscoveryProspectById(prospectId) {
  return discoveryProspects.find((prospect) => prospect.id === prospectId) || null;
}

export function getDiscoveryProspectsForArea(areaId) {
  const area = getDiscoveryArea(areaId);
  if (!area) return [];
  return discoveryProspects
    .filter((prospect) => slugify(prospect.searchOrigin || prospect.name) === area.id)
    .sort((left, right) => (right.fitScore || 0) - (left.fitScore || 0) || left.name.localeCompare(right.name));
}

export function getDiscoveryOverview() {
  return {
    totalProspects: discoveryProspects.length,
    totalAreas: discoveryAreas.length,
    topBrands: getTopBrands(discoveryProspects, 6),
    averageFitScore:
      discoveryProspects.length > 0
        ? Number((discoveryProspects.reduce((total, prospect) => total + (prospect.fitScore || 0), 0) / discoveryProspects.length).toFixed(1))
        : 0,
  };
}

function getAcceptedClusters(state) {
  return (state?.acceptedClusters || []).map((cluster, index) => ({
    ...cluster,
    colorClass: cluster.colorClass || acceptedClusterPalette[index % acceptedClusterPalette.length],
    routeTime: cluster.routeTime || `${Math.max(18, (cluster.prospectIds?.length || 1) * 7)} min`,
  }));
}

export function getAllClusters(state) {
  return [...baseClusters, ...getAcceptedClusters(state)];
}

export function getCluster(clusterId, state = null) {
  return getAllClusters(state).find((cluster) => cluster.id === clusterId);
}

function getAcceptedClusterDealerships(state, clusterId) {
  const acceptedCluster = getAcceptedClusters(state).find((cluster) => cluster.id === clusterId);
  if (!acceptedCluster) return [];

  return (acceptedCluster.prospectIds || [])
    .map((prospectId, index) => {
      const prospect = getDiscoveryProspectById(prospectId);
      if (!prospect) return null;
      return {
        id: prospect.id,
        clusterId: acceptedCluster.id,
        order: index + 1,
        name: prospect.name,
        shortName: prospect.shortName || prospect.name.split(" ")[0],
        address: prospect.address || prospect.searchOrigin || "Address not fully tagged",
        roleHint: prospect.roleHint || "Ask for showroom manager or business manager",
        contactHint: prospect.contactHint || "Decision-maker name not yet confirmed",
        parentGroup: prospect.parentGroup || "Dealership",
        brands: Array.isArray(prospect.brands) ? prospect.brands : [],
        phone: prospect.phone || "",
        website: prospect.website || "",
        pitch: prospect.pitch || "",
        location: prospect.location,
        radar: prospect.radar || { left: 50, top: 50 },
        intelDistance: prospect.intelDistance || "",
        sourceType: prospect.sourceType || "discovery",
        sourceQuery: prospect.query || prospect.name,
      };
    })
    .filter(Boolean);
}

function getManualDealerships(state) {
  return Array.isArray(state?.manualDealerships) ? state.manualDealerships : [];
}

export function getAllDealerships(state) {
  const acceptedDealerships = getAcceptedClusters(state).flatMap((cluster) => getAcceptedClusterDealerships(state, cluster.id));
  return [...dealerships, ...acceptedDealerships, ...getManualDealerships(state)];
}

export function getDealershipStatic(dealershipId) {
  return dealerships.find((dealership) => dealership.id === canonicalDealershipId(dealershipId));
}

export function getDealershipRuntime(state, dealershipId) {
  const canonicalId = canonicalDealershipId(dealershipId);
  return state.dealerships.find((dealership) => canonicalDealershipId(dealership.id) === canonicalId);
}

export function mergeDealership(state, dealershipId) {
  return {
    ...(getAllDealerships(state).find((dealership) => dealership.id === canonicalDealershipId(dealershipId)) || {}),
    ...(getDealershipRuntime(state, dealershipId) || {}),
  };
}

export function getDealershipsForCluster(state, clusterId) {
  return getAllDealerships(state)
    .filter((dealership) => dealership.clusterId === clusterId)
    .sort((left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER) || left.name.localeCompare(right.name))
    .map((dealership) => ({ ...dealership, ...(getDealershipRuntime(state, dealership.id) || {}) }));
}

export function upsertManualDealership(state, payload = {}) {
  const name = String(payload.name || "").trim();
  const address = String(payload.address || "").trim();
  if (!name || !address) {
    throw new Error("Manual dealership requires both a name and an address.");
  }

  const clusterId = payload.clusterId || state.selectedClusterId || baseClusters[0].id;
  const currentManual = getManualDealerships(state);
  const existing = currentManual.find((item) => item.id === payload.id) ||
    currentManual.find(
      (item) =>
        slugify(item.name) === slugify(name) &&
        slugify(item.address) === slugify(address),
    ) ||
    null;

  const nextOrder =
    existing?.order ||
    getAllDealerships(state)
      .filter((dealership) => dealership.clusterId === clusterId)
      .reduce((highest, dealership) => Math.max(highest, Number(dealership.order) || 0), 0) +
      1;

  const nextDealership = {
    ...existing,
    id: existing?.id || payload.id || `manual-${slugify(name)}-${Date.now().toString(36).slice(-4)}`,
    clusterId,
    order: nextOrder,
    name,
    shortName:
      String(payload.shortName || existing?.shortName || "")
        .trim() || name.split(/\s+/).slice(0, 2).join(" "),
    address,
    roleHint: String(payload.roleHint || existing?.roleHint || "Ask for showroom manager or dealer principal").trim(),
    contactHint: String(payload.contactHint || existing?.contactHint || "Manual add - decision-maker not yet confirmed").trim(),
    parentGroup: String(payload.parentGroup || existing?.parentGroup || "Manufacturer or branded dealership").trim(),
    brands: Array.isArray(payload.brands) ? payload.brands : existing?.brands || [],
    phone: String(payload.phone || existing?.phone || "").trim(),
    website: String(payload.website || existing?.website || "").trim(),
    pitch: String(
      payload.pitch ||
        existing?.pitch ||
        "Visited manually outside the scraped pin set. Test appetite for Battersea overflow, handover, or stock staging use.",
    ).trim(),
    location: Array.isArray(payload.location) ? payload.location : existing?.location || null,
    radar: payload.radar || existing?.radar || { left: 52, top: 48 },
    intelDistance: String(payload.intelDistance || existing?.intelDistance || "Manual add").trim(),
    status: String(payload.status || existing?.status || "Not visited").trim(),
    leadScore: Number(payload.leadScore ?? existing?.leadScore ?? 40),
    nextAction: String(payload.nextAction || existing?.nextAction || "Visit and capture contact details").trim(),
    sourceType: "manual",
    sourceLabel: String(payload.sourceLabel || existing?.sourceLabel || "Manual intake").trim(),
    geocodeLabel: String(payload.geocodeLabel || existing?.geocodeLabel || "").trim(),
    isManual: true,
  };

  state.manualDealerships = [
    nextDealership,
    ...currentManual.filter((item) => item.id !== nextDealership.id),
  ];
  state.selectedClusterId = clusterId;
  state.currentDealershipId = nextDealership.id;
  return nextDealership;
}

export function createOperationalClusterFromDiscoveryArea(state, areaId, preferredName) {
  const area = getDiscoveryArea(areaId);
  if (!area) return null;

  const existing = getAcceptedClusters(state).find((cluster) => cluster.sourceAreaId === areaId);
  if (existing) {
    if (preferredName && preferredName.trim()) {
      existing.name = preferredName.trim();
    }
    state.parkedDiscoveryAreaIds = (state.parkedDiscoveryAreaIds || []).filter((id) => id !== areaId);
    state.selectedClusterId = existing.id;
    state.currentDealershipId = existing.prospectIds?.[0] || state.currentDealershipId;
    return existing;
  }

  const prospects = getDiscoveryProspectsForArea(areaId);
  if (!prospects.length) return null;

  const clusterName = preferredName || `${area.name} field cluster`;
  const clusterId = `field-${slugify(areaId)}`;
  const nextCluster = {
    id: clusterId,
    name: clusterName,
    sourceAreaId: areaId,
    prospectIds: prospects.map((prospect) => prospect.id),
    colorClass: acceptedClusterPalette[(state.acceptedClusters || []).length % acceptedClusterPalette.length],
    routeTime: `${Math.max(18, prospects.length * 7)} min`,
  };

  state.acceptedClusters = [...(state.acceptedClusters || []), nextCluster];
  state.parkedDiscoveryAreaIds = (state.parkedDiscoveryAreaIds || []).filter((id) => id !== areaId);
  state.selectedClusterId = clusterId;
  state.currentDealershipId = prospects[0].id;
  return nextCluster;
}

export function setDiscoveryAreaParked(state, areaId, parked = true) {
  const current = new Set(state.parkedDiscoveryAreaIds || []);
  if (parked) current.add(areaId);
  else current.delete(areaId);
  state.parkedDiscoveryAreaIds = [...current];
}

export function getClusterLocations(state, clusterId) {
  return getDealershipsForCluster(state, clusterId)
    .map((dealership) => dealership.location)
    .filter((location) => Array.isArray(location) && location.length === 2);
}

export function getClusterRouteCoordinates(state, clusterId) {
  return getOptimizedDealershipsForCluster(state, clusterId)
    .filter((dealership) => Array.isArray(dealership.location))
    .map((dealership) => dealership.location);
}

export function getOptimizedDealershipsForCluster(state, clusterId, startLocation = null) {
  const allStops = getDealershipsForCluster(state, clusterId);
  const geoStops = allStops.filter((dealership) => Array.isArray(dealership.location));
  const nonGeoStops = allStops.filter((dealership) => !Array.isArray(dealership.location));

  if (geoStops.length <= 1) {
    return [...geoStops.map((stop, index) => ({ ...stop, routeOrder: index + 1, routeDistanceMiles: 0 })), ...nonGeoStops];
  }

  return [...routeSortFromReference(geoStops, startLocation), ...nonGeoStops];
}

export function getClusterCenter(state, clusterId) {
  const locations = getClusterLocations(state, clusterId);
  return getCenterForLocations(locations);
}

export function getClusterCoverageFeature(state, clusterId) {
  const locations = getClusterLocations(state, clusterId);
  return getCoverageFeatureForLocations(locations);
}

export function getClusterCoveragePolygon(state, clusterId) {
  return getCoveragePolygonForLocations(getClusterLocations(state, clusterId));
}

export function buildGoogleMapsRouteUrl(state, clusterId, options = {}) {
  const routeStops = getOptimizedDealershipsForCluster(state, clusterId, options.startLocation).filter((dealership) => Array.isArray(dealership.location));
  if (!routeStops.length) return "https://www.google.com/maps";

  const [origin, ...rest] = routeStops;
  const destination = rest.length ? rest[rest.length - 1] : origin;
  const waypoints = rest.slice(0, -1);
  const base = "https://www.google.com/maps/dir/?api=1";
  const originParam = `origin=${origin.location.join(",")}`;
  const destinationParam = `destination=${destination.location.join(",")}`;
  const travelModeParam = "travelmode=driving";
  const waypointParam = waypoints.length ? `&waypoints=${waypoints.map((stop) => stop.location.join(",")).join("|")}` : "";
  return `${base}&${originParam}&${destinationParam}${waypointParam}&${travelModeParam}`;
}

export function buildMailtoDraftUrl({ toAddress = "", subject = "", body = "", cc = "", bcc = "" }) {
  const params = new URLSearchParams();
  if (subject) params.set("subject", subject);
  if (body) params.set("body", body);
  if (cc) params.set("cc", cc);
  if (bcc) params.set("bcc", bcc);
  return `mailto:${encodeURIComponent(toAddress)}${params.toString() ? `?${params.toString()}` : ""}`;
}

export function buildOutlookAppComposeUrl({ toAddress = "", subject = "", body = "", cc = "", bcc = "" }) {
  const params = [
    ["to", toAddress],
    ["subject", subject],
    ["body", body],
    ["cc", cc],
    ["bcc", bcc],
  ]
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return `ms-outlook://compose?${params}`;
}

export function buildOutlookWebComposeUrl({ toAddress = "", subject = "", body = "", cc = "", bcc = "" }) {
  const params = new URLSearchParams();
  if (toAddress) params.set("to", toAddress);
  if (subject) params.set("subject", subject);
  if (body) params.set("body", body);
  if (cc) params.set("cc", cc);
  if (bcc) params.set("bcc", bcc);
  return `https://outlook.office.com/mail/deeplink/compose?${params.toString()}`;
}

export function getLatestVisit(state, dealershipId) {
  const canonicalId = canonicalDealershipId(dealershipId);
  return state.visits.find((visit) => canonicalDealershipId(visit.dealershipId) === canonicalId) || null;
}

export function getLatestContact(state, dealershipId) {
  const canonicalId = canonicalDealershipId(dealershipId);
  return state.contacts.find((contact) => canonicalDealershipId(contact.dealershipId) === canonicalId) || null;
}

export function getLatestMedia(state, dealershipId) {
  const canonicalId = canonicalDealershipId(dealershipId);
  return state.media.find((item) => canonicalDealershipId(item.dealershipId) === canonicalId) || null;
}

function normalizeDomain(website = "") {
  return String(website || "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase();
}

function extractEmailCandidates(text = "") {
  const matches = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return matches.map((value) => value.trim().toLowerCase()).filter((value, index, array) => array.indexOf(value) === index);
}

export function getDraftForDealership(state, dealershipId) {
  const canonicalId = canonicalDealershipId(dealershipId);
  return state.emailDrafts.find((draft) => canonicalDealershipId(draft.dealershipId) === canonicalId && draft.status !== "archived") || null;
}

export function sameOutcomes(left = [], right = []) {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((item, index) => item === b[index]);
}

export function summarizeStatusFromOutcomes(outcomes) {
  if (outcomes.includes("Not suitable")) return "Not suitable";
  if (outcomes.includes("Site walk booked")) return "Site walk booked";
  if (outcomes.includes("Interested")) return "Interested";
  if (outcomes.includes("Met manager")) return "Met manager";
  return "Visited";
}

export function deriveEmailType(outcomes, preferredType = "") {
  if (preferredType) return preferredType;
  if (outcomes.includes("Site walk booked")) return "Site walk confirmation";
  if (outcomes.includes("Deferred to decision maker")) return "Decision-maker intro request";
  if (outcomes.includes("Card captured") && !outcomes.includes("Needs email")) return "Contact verification";
  if (outcomes.includes("Not suitable")) return "Polite close-out";
  if (outcomes.includes("Needs email") || outcomes.includes("Interested")) return "Site details follow-up";
  return "Standard follow-up";
}

export function generateSuggestedAddresses(state, dealershipId) {
  return buildSuggestedRecipientOptions(state, dealershipId).map((item) => item.address);
}

export function buildSuggestedRecipientOptions(state, dealershipId) {
  const dealership = mergeDealership(state, dealershipId);
  const contact = getLatestContact(state, dealershipId);
  const latestMedia = getLatestMedia(state, dealershipId);
  const domain = normalizeDomain(dealership.website);
  const contactSlug = contact?.name ? contact.name.toLowerCase().replace(/ /g, ".") : null;
  const options = [];
  const seen = new Set();

  function push(address, source, label = "") {
    const normalized = String(address || "").trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    options.push({
      address: normalized,
      source,
      label: label || source,
    });
  }

  push(contact?.email, "Verified contact", contact?.name ? `${contact.name}${contact.role ? `, ${contact.role}` : ""}` : "Verified contact");
  extractEmailCandidates(latestMedia?.rawText).forEach((address) => push(address, "OCR capture", "Found in captured card"));
  push(contactSlug && domain ? `${contactSlug}@${domain}` : "", "Derived from contact", "Name + website domain");
  push(domain ? `sales@${domain}` : "", "Website fallback", "Generic sales inbox");
  push(domain ? `info@${domain}` : "", "Website fallback", "Generic info inbox");

  return options;
}

export function buildEmailSubject(state, dealershipId, emailType) {
  const dealership = mergeDealership(state, dealershipId);

  if (emailType === "Site walk confirmation") return `Battersea site walk for ${dealership.name}`;
  if (emailType === "Decision-maker intro request") return `${dealership.name} property contact intro`;
  if (emailType === "Contact verification") return `${dealership.name} contact details check`;
  if (emailType === "Polite close-out") return `${dealership.name} follow-up`;
  if (emailType === "Site details follow-up") return `Battersea site details for ${dealership.name}`;
  return `Good to meet you - ${dealership.name}`;
}

function formatEmailBody(greeting, paragraphs, signoffName = "Charlie") {
  return [
    greeting,
    ...paragraphs.map((paragraph) => String(paragraph || "").trim()).filter(Boolean),
    "Best regards,",
    signoffName,
  ].join("\n\n");
}

export function getEmailIntentDetails(intentIds = []) {
  return intentIds
    .map((intentId) => emailIntentCatalog.find((item) => item.id === intentId || item.label === intentId))
    .filter(Boolean);
}

export function buildEmailDraft(state, dealershipId, outcomes, options = {}) {
  const dealership = mergeDealership(state, dealershipId);
  const contact = getLatestContact(state, dealershipId);
  const latestVisit = getLatestVisit(state, dealershipId);
  const latestMedia = getLatestMedia(state, dealershipId);
  const intentDetails = getEmailIntentDetails(options.emailIntents || []);
  const greeting = contact ? `Hi ${contact.name.split(" ")[0]},` : "Hi,";
  const emailType = deriveEmailType(outcomes, options.emailType || intentDetails[0]?.emailType || "");
  const subject = buildEmailSubject(state, dealershipId, emailType);
  const noteLine = latestVisit?.note ? ` ${latestVisit.note}` : "";
  const mediaLine = latestMedia?.rawText ? " I have also logged the contact details captured on site." : "";

  if (intentDetails.length) {
    const bodyBlocks = intentDetails.map((intent) => intent.templateBlock);
    const contextLine = noteLine || mediaLine ? `${noteLine}${mediaLine}` : "";
    return {
      emailType,
      subject,
      body: formatEmailBody(greeting, [...bodyBlocks, contextLine]),
      emailIntents: intentDetails.map((intent) => intent.id),
    };
  }

  if (emailType === "Site walk confirmation") {
    return {
      emailType,
      subject,
      body: formatEmailBody(greeting, [
        `Thanks again for your time today at ${dealership.name}. I have noted the site walk and can hold a Thursday 10:30 slot for the Battersea viewing. I will send over the access notes, yard dimensions, and a short pre-market pack so the visit is useful from the outset.${noteLine}${mediaLine}`,
      ]),
    };
  }

  if (emailType === "Decision-maker intro request") {
    return {
      emailType,
      subject,
      body: formatEmailBody(greeting, [
        `Thanks again for taking a few minutes today at ${dealership.name}. As discussed, if the property decision sits with the owner or another decision-maker, I would be grateful if you could point me in the right direction. I can then send a short Battersea pack covering access, frontage, and how the unit may work for overflow stock or handover use.${noteLine}${mediaLine}`,
      ]),
    };
  }

  if (emailType === "Contact verification") {
    return {
      emailType,
      subject,
      body: formatEmailBody(greeting, [
        "Thanks again for the quick conversation today. I have noted your details from the card I captured and will send a short Battersea summary once I have confirmed the best email address for the right person internally.",
      ]),
    };
  }

  if (emailType === "Polite close-out") {
    return {
      emailType,
      subject,
      body: formatEmailBody(greeting, [
        "Thanks for taking the time earlier today. I appreciate the clarity on your current property position. I will close the loop on my side for now, but if your requirements change and a Battersea base, overflow unit, or handover space becomes relevant, I would be happy to pick the conversation back up.",
      ]),
    };
  }

  if (emailType === "Site details follow-up") {
    return {
      emailType,
      subject,
      body: formatEmailBody(greeting, [
        `Great meeting you today at ${dealership.name}. As discussed, I can send over the Battersea site details, including access, yard dimensions, frontage, and how the unit could work for overflow storage, handover use, or stock staging.${noteLine}${mediaLine} If helpful, I can also arrange a short walk-through this week.`,
      ]),
    };
  }

  return {
    emailType,
    subject,
    body: formatEmailBody(greeting, [
      `Great meeting you today at ${dealership.name}. I just wanted to touch base on email and keep the conversation moving.${noteLine}${mediaLine} If useful, I can send across a short Battersea overview and suggest the next practical step from here.`,
    ]),
  };
}

export function buildDraftBody(state, dealershipId, outcomes, options = {}) {
  return buildEmailDraft(state, dealershipId, outcomes, options).body;
}

export function buildAdminEntries(outcomes) {
  const entries = [];
  outcomes.forEach((outcome) => {
    const rule = outcomeRules[outcome];
    if (!rule) return;
    (rule.adminActions || []).forEach((label) => {
      entries.push({
        label,
        type: rule.createAction ? "Task" : "Admin",
        detail: `Generated from outcome: ${outcome}`,
      });
    });
  });
  return entries.length
    ? entries
    : [{ label: "Record visit history", type: "Admin", detail: "No downstream tasks yet." }];
}

export function createActionsFromOutcomes(outcomes, dealershipId, options = {}) {
  return outcomes.reduce((items, outcome) => {
    const rule = outcomeRules[outcome];
    if (!rule?.createAction) return items;
    const dueAt = options.scheduleAt || buildDueAtFromPreset(rule.createAction.duePreset, new Date());
    items.push({
      id: uid("action"),
      dealershipId,
      title: rule.createAction.title,
      type: rule.createAction.type,
      dueAt,
      dueText: formatActionDueLabel({ dueAt }),
      priority: rule.createAction.type === "email" || rule.createAction.type === "site_walk" ? "high" : "medium",
      status: "pending",
      note: `Generated from ${outcome}`,
    });
    return items;
  }, []);
}

export function upsertDraft(state, dealershipId, outcomes, status = "draft", draftOverrides = {}) {
  const generated = buildEmailDraft(state, dealershipId, outcomes, {
    emailType: draftOverrides.emailType,
    emailIntents: draftOverrides.emailIntents,
  });
  const nextEmailType = draftOverrides.emailType || generated.emailType;
  const nextSubject = draftOverrides.subject || generated.subject;
  const nextBody = draftOverrides.body || generated.body;
  const nextToAddress = draftOverrides.toAddress || generateSuggestedAddresses(state, dealershipId)[0] || "";
  const current = state.emailDrafts.find((draft) => draft.dealershipId === dealershipId);
  if (current) {
    current.outcomes = [...outcomes];
    current.emailType = nextEmailType;
    current.subject = nextSubject;
    current.body = nextBody;
    current.toAddress = nextToAddress;
    current.generationMode = draftOverrides.generationMode || current.generationMode || "template";
    current.emailIntents = [...(draftOverrides.emailIntents || current.emailIntents || [])];
    current.status = status;
    current.createdAt = new Date().toISOString().slice(0, 16).replace("T", " ");
    return current;
  }
  const created = {
    id: uid("draft"),
    dealershipId,
    outcomes: [...outcomes],
    emailType: nextEmailType,
    subject: nextSubject,
    body: nextBody,
    toAddress: nextToAddress,
    generationMode: draftOverrides.generationMode || "template",
    emailIntents: [...(draftOverrides.emailIntents || [])],
    status,
    createdAt: new Date().toISOString().slice(0, 16).replace("T", " "),
  };
  state.emailDrafts.unshift(created);
  return created;
}

export function ensureEmailAction(state, dealershipId, status = "pending") {
  const existing = state.actions.find((action) => action.dealershipId === dealershipId && action.type === "email");
  if (existing) {
    existing.status = status;
    existing.note = "Generated from FGI email flow";
    if (!existing.dueAt) {
      existing.dueAt = buildDueAtFromPreset({ offsetDays: 0, hour: 16, minute: 30 }, new Date());
      existing.dueText = formatActionDueLabel(existing);
    }
    return existing;
  }
  const dueAt = buildDueAtFromPreset({ offsetDays: 0, hour: 16, minute: 30 }, new Date());
  const created = {
    id: uid("action"),
    dealershipId,
    title: "Send follow-up email",
    type: "email",
    dueAt,
    dueText: formatActionDueLabel({ dueAt }),
    priority: "high",
    status,
    note: "Generated from FGI email flow",
  };
  state.actions.unshift(created);
  return created;
}

export function captureMockContact(state, dealershipId) {
  const dealership = mergeDealership(state, dealershipId);
  const suggestedName =
    dealership.id === "west4-auto-centre"
      ? "Priya Shah"
      : dealership.id === "chiswick-motor-house"
        ? "James Patel"
        : "Matthew Carter";
  const role =
    dealership.id === "west4-auto-centre"
      ? "Operations Manager"
      : dealership.id === "chiswick-motor-house"
        ? "Dealer Principal"
        : "Sales Manager";
  const emailSlug = suggestedName.toLowerCase().replace(/ /g, ".");

  state.contacts.unshift({
    id: uid("contact"),
    dealershipId,
    name: suggestedName,
    role,
    email: `${emailSlug}@${dealership.website}`,
    phone: dealership.phone,
    source: "ocr",
  });
  state.media.unshift({
    id: uid("media"),
    dealershipId,
    type: "business_card",
    status: "ocr-complete",
    createdAt: new Date().toISOString().slice(0, 16).replace("T", " "),
  });
  return suggestedName;
}

export function saveOcrCapture(state, dealershipId, payload) {
  const dealership = mergeDealership(state, dealershipId);
  const cleaned = {
    name: String(payload?.name || "").trim(),
    role: String(payload?.role || "").trim(),
    email: String(payload?.email || "").trim(),
    phone: String(payload?.phone || "").trim(),
    company: String(payload?.company || dealership.name || "").trim(),
    rawText: String(payload?.rawText || "").trim(),
    source: payload?.source || "ocr",
    fileName: String(payload?.fileName || "capture").trim(),
    mediaType: payload?.mediaType || "business_card",
  };

  const hasContactSignal = cleaned.name || cleaned.email || cleaned.phone;
  if (hasContactSignal) {
    state.contacts = state.contacts.filter(
      (contact) =>
        !(
          contact.dealershipId === dealershipId &&
          ((cleaned.email && contact.email === cleaned.email) || (cleaned.name && contact.name === cleaned.name))
        ),
    );
    state.contacts.unshift({
      id: uid("contact"),
      dealershipId,
      name: cleaned.name || dealership.name,
      role: cleaned.role || "Contact pending title",
      email: cleaned.email || "",
      phone: cleaned.phone || "",
      source: cleaned.source,
    });
  }

  state.media.unshift({
    id: uid("media"),
    dealershipId,
    type: cleaned.mediaType,
    status: "ocr-complete",
    createdAt: new Date().toISOString().slice(0, 16).replace("T", " "),
    source: cleaned.source,
    fileName: cleaned.fileName,
    company: cleaned.company,
    rawText: cleaned.rawText,
  });

  const runtime = getDealershipRuntime(state, dealershipId);
  if (runtime) {
    runtime.nextAction = cleaned.email ? "Send follow-up email" : "Verify OCR contact details";
  }

  const latestVisit = getLatestVisit(state, dealershipId);
  const draftOutcomes = latestVisit?.outcomes?.length ? latestVisit.outcomes : ["Card captured", "Needs email"];
  upsertDraft(state, dealershipId, draftOutcomes, "draft");
  ensureEmailAction(state, dealershipId, "pending");
}

export function applyVisitOutcomes(state, dealershipId, outcomes, note, options = {}) {
  const runtime = getDealershipRuntime(state, dealershipId);
  const dealership = runtime || { id: dealershipId, status: "Not visited", leadScore: 35 };
  const scoreDelta = outcomes.reduce((total, outcome) => total + (outcomeRules[outcome]?.scoreDelta || 0), 0);

  dealership.leadScore = Math.max(0, (dealership.leadScore || 35) + scoreDelta);
  dealership.status = summarizeStatusFromOutcomes(outcomes);
  dealership.nextAction = buildAdminEntries(outcomes)[0].label;

  if (!runtime) {
    state.dealerships.push(dealership);
  }

  state.actions = state.actions.filter((action) => !(action.dealershipId === dealershipId && action.status === "pending"));

  const visit = {
    id: uid("visit"),
    dealershipId,
    clusterId: mergeDealership(state, dealershipId).clusterId,
    outcomes: [...outcomes],
    note,
    createdAt: new Date().toISOString().slice(0, 16).replace("T", " "),
  };

  state.visits.unshift(visit);
  createActionsFromOutcomes(outcomes, dealershipId, { scheduleAt: options.scheduleAt }).forEach((action) => state.actions.unshift(action));

  if (outcomes.some((outcome) => outcomeRules[outcome]?.createDraft)) {
    upsertDraft(state, dealershipId, outcomes, "draft");
  }

  state.selectedClusterId = mergeDealership(state, dealershipId).clusterId;
  state.currentDealershipId = dealershipId;
  return visit;
}
