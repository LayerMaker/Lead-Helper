import { featureCollection, lineString, point } from "@turf/helpers";
import { buffer } from "@turf/buffer";
import { centerOfMass } from "@turf/center-of-mass";
import { convex } from "@turf/convex";
import dealershipsData from "../data/dealerships.normalized.json";

const MAP_V2_VERSION = 1;
const POINT_BUFFER_KM = 0.45;
const LINE_BUFFER_KM = 0.32;
const POLYGON_BUFFER_KM = 0.22;
const LONDON_CENTER = [51.4838, -0.2153];

const clusterSeed = [
  { id: "chiswick", name: "Chiswick", colour: "amber", lifecycle: "accepted", strategy: "legacy" },
  { id: "battersea", name: "Battersea", colour: "mint", lifecycle: "accepted", strategy: "legacy" },
  { id: "wandsworth", name: "Wandsworth", colour: "rose", lifecycle: "accepted", strategy: "legacy" },
  { id: "brentford", name: "Brentford", colour: "teal", lifecycle: "accepted", strategy: "legacy" },
];

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function nowIso() {
  return new Date().toISOString();
}

function toGeoPoint(location, properties = {}) {
  return point([location[1], location[0]], properties);
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
  if (geometry.type === "Polygon") return geometry.coordinates[0] || [];
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates
      .map((polygonCoordinates) => polygonCoordinates[0] || [])
      .sort((left, right) => polygonArea(right) - polygonArea(left))[0] || [];
  }
  return [];
}

export function getMapV2PinIdFromLegacyId(legacyId) {
  return `pin-${slugify(legacyId)}`;
}

export function createMapV2ManualPinId(name, address) {
  return `pin-manual-${slugify(name)}-${slugify(address).slice(0, 32)}`;
}

function createPinFromDealership(dealership) {
  const createdAt = nowIso();
  return {
    id: getMapV2PinIdFromLegacyId(dealership.id),
    legacyDealershipId: dealership.id,
    name: dealership.name,
    address: dealership.address || dealership.searchOrigin || "Address not fully tagged",
    location: Array.isArray(dealership.location) ? dealership.location : null,
    brands: Array.isArray(dealership.brands) ? dealership.brands : [],
    website: dealership.website || "",
    phone: dealership.phone || "",
    source: dealership.sourceType || "legacy",
    sourceRef: dealership.id,
    confidence: Array.isArray(dealership.location) ? "confirmed" : "needs-review",
    status: "unvisited",
    createdAt,
    updatedAt: createdAt,
  };
}

function createAssignmentFromDealership(dealership) {
  if (!dealership.clusterId) return null;
  const assignedAt = nowIso();
  return {
    id: `assignment-${slugify(dealership.clusterId)}-${slugify(dealership.id)}`,
    clusterId: dealership.clusterId,
    pinId: getMapV2PinIdFromLegacyId(dealership.id),
    assignmentType: "accepted",
    confidence: 1,
    assignedAt,
    assignedBy: "system",
  };
}

export function createInitialMapV2State() {
  const pins = dealershipsData.map(createPinFromDealership);
  const assignments = dealershipsData.map(createAssignmentFromDealership).filter(Boolean);
  const createdAt = nowIso();

  return {
    version: MAP_V2_VERSION,
    active: false,
    pins,
    clusters: clusterSeed.map((cluster) => ({
      ...cluster,
      targetSession: "half-day",
      createdAt,
      updatedAt: createdAt,
    })),
    assignments,
    geometries: [],
    reportSnapshots: [],
  };
}

export function ensureMapV2State(state) {
  if (state?.mapV2?.version === MAP_V2_VERSION) return state.mapV2;
  return createInitialMapV2State();
}

export function getMapV2Clusters(state) {
  return ensureMapV2State(state).clusters || [];
}

export function getMapV2Pins(state) {
  return ensureMapV2State(state).pins || [];
}

export function getMapV2Assignments(state) {
  return ensureMapV2State(state).assignments || [];
}

export function getMapV2AssignmentsForCluster(state, clusterId) {
  return getMapV2Assignments(state).filter((assignment) => assignment.clusterId === clusterId && assignment.assignmentType !== "rejected");
}

export function getMapV2PinsForCluster(state, clusterId) {
  const assignmentPinIds = new Set(getMapV2AssignmentsForCluster(state, clusterId).map((assignment) => assignment.pinId));
  return getMapV2Pins(state).filter((pin) => assignmentPinIds.has(pin.id));
}

export function getMapV2UnassignedPins(state) {
  const assignedPinIds = new Set(getMapV2Assignments(state).filter((assignment) => assignment.assignmentType !== "rejected").map((assignment) => assignment.pinId));
  return getMapV2Pins(state).filter((pin) => !assignedPinIds.has(pin.id));
}

export function getMapV2ClusterForPin(state, pinId) {
  const assignment = getMapV2Assignments(state).find((item) => item.pinId === pinId && item.assignmentType !== "rejected");
  if (!assignment) return null;
  return getMapV2Clusters(state).find((cluster) => cluster.id === assignment.clusterId) || null;
}

export function getMapV2CenterForPins(pins) {
  const locations = pins.map((pin) => pin.location).filter((location) => Array.isArray(location));
  if (!locations.length) return LONDON_CENTER;
  if (locations.length === 1) return locations[0];
  const center = centerOfMass(featureCollection(locations.map((location) => toGeoPoint(location))));
  return [center.geometry.coordinates[1], center.geometry.coordinates[0]];
}

export function getMapV2BoundaryForPins(pins) {
  const locations = pins.map((pin) => pin.location).filter((location) => Array.isArray(location));
  if (!locations.length) return [];

  let coverageFeature;
  if (locations.length === 1) {
    coverageFeature = buffer(toGeoPoint(locations[0]), POINT_BUFFER_KM, { units: "kilometers", steps: 24 });
  } else if (locations.length === 2) {
    coverageFeature = buffer(lineString(locations.map(([lat, lng]) => [lng, lat])), LINE_BUFFER_KM, { units: "kilometers", steps: 24 });
  } else {
    const hull = convex(featureCollection(locations.map((location) => toGeoPoint(location))));
    coverageFeature = hull ? buffer(hull, POLYGON_BUFFER_KM, { units: "kilometers", steps: 24 }) || hull : null;
  }

  const ring = getLargestOuterRing(coverageFeature?.geometry);
  if (!ring.length) return [];

  const leafletCoordinates = toLeafletCoordinates(ring);
  const [firstLat, firstLng] = leafletCoordinates[0] || [];
  const [lastLat, lastLng] = leafletCoordinates[leafletCoordinates.length - 1] || [];
  if (firstLat === lastLat && firstLng === lastLng) return leafletCoordinates.slice(0, -1);
  return leafletCoordinates;
}

export function createMapV2PinFromManualPayload(payload = {}) {
  const createdAt = nowIso();
  const name = String(payload.name || "").trim();
  const address = String(payload.address || "").trim();
  const pinId = payload.pinId || createMapV2ManualPinId(name, address);

  return {
    id: pinId,
    legacyDealershipId: payload.legacyDealershipId || "",
    name,
    address,
    location: Array.isArray(payload.location) ? payload.location : null,
    brands: Array.isArray(payload.brands) ? payload.brands : [],
    website: String(payload.website || "").trim(),
    phone: String(payload.phone || "").trim(),
    source: "manual",
    sourceRef: payload.sourceRef || "add-location",
    confidence: Array.isArray(payload.location) ? "confirmed" : "needs-review",
    status: "unvisited",
    createdAt,
    updatedAt: createdAt,
  };
}

export function upsertMapV2Pin(mapV2, pin) {
  const currentPins = mapV2.pins || [];
  const existing = currentPins.find((item) => item.id === pin.id);
  const nextPin = existing
    ? {
        ...existing,
        ...pin,
        createdAt: existing.createdAt,
        updatedAt: nowIso(),
      }
    : pin;

  return {
    ...mapV2,
    pins: [nextPin, ...currentPins.filter((item) => item.id !== nextPin.id)],
  };
}

export function assignMapV2PinToCluster(mapV2, pinId, clusterId, options = {}) {
  const assignmentId = `assignment-${slugify(clusterId)}-${slugify(pinId)}`;
  const nextAssignment = {
    id: assignmentId,
    clusterId,
    pinId,
    assignmentType: options.assignmentType || "manual",
    confidence: options.confidence ?? 1,
    assignedAt: nowIso(),
    assignedBy: options.assignedBy || "user",
  };

  return {
    ...mapV2,
    assignments: [
      nextAssignment,
      ...(mapV2.assignments || []).filter((assignment) => assignment.pinId !== pinId || assignment.clusterId !== clusterId),
    ],
  };
}
