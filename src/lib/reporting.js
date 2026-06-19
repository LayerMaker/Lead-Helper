import { canonicalDealershipId, getClusterCoveragePolygon, getEmailIntentDetails } from "./leadHelperModel";

const MAP_WIDTH = 980;
const MAP_HEIGHT = 320;
const MAP_PADDING = 30;

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(value) {
  if (!value) return "No timestamp";
  const normalized = String(value).replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getEmailProofLabel(draft) {
  if (!draft) return "Not started";
  if (draft.proofLabel) return draft.proofLabel;
  if (draft.status === "sent") return "Sent";
  if (draft.status === "opened") return "Outlook opened";
  return "Draft ready";
}

function getBounds(points) {
  if (!points.length) {
    return {
      minLat: 51.45,
      maxLat: 51.5,
      minLng: -0.3,
      maxLng: -0.12,
    };
  }

  return points.reduce(
    (bounds, [lat, lng]) => ({
      minLat: Math.min(bounds.minLat, lat),
      maxLat: Math.max(bounds.maxLat, lat),
      minLng: Math.min(bounds.minLng, lng),
      maxLng: Math.max(bounds.maxLng, lng),
    }),
    {
      minLat: Number.POSITIVE_INFINITY,
      maxLat: Number.NEGATIVE_INFINITY,
      minLng: Number.POSITIVE_INFINITY,
      maxLng: Number.NEGATIVE_INFINITY,
    },
  );
}

function projectPoint([lat, lng], bounds) {
  const lngSpan = Math.max(bounds.maxLng - bounds.minLng, 0.001);
  const latSpan = Math.max(bounds.maxLat - bounds.minLat, 0.001);
  const x = MAP_PADDING + ((lng - bounds.minLng) / lngSpan) * (MAP_WIDTH - MAP_PADDING * 2);
  const y = MAP_HEIGHT - MAP_PADDING - ((lat - bounds.minLat) / latSpan) * (MAP_HEIGHT - MAP_PADDING * 2);
  return [Number(x.toFixed(1)), Number(y.toFixed(1))];
}

function getInitials(name) {
  const words = String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  return words.map((word) => word[0]).join("").toUpperCase() || "LH";
}

function statusTone(status) {
  if (status === "Site walk booked") return "success";
  if (status === "Interested") return "warm";
  if (status === "Not suitable") return "muted";
  return "default";
}

export function buildClusterReportModel({
  state,
  cluster,
  dealerships,
  getDraftForDealership,
  getLatestContact,
  getLatestMedia,
}) {
  const clusterId = cluster.id;
  const clusterVisits = state.visits.filter((visit) => visit.clusterId === clusterId);
  const clusterActions = state.actions.filter((action) =>
    dealerships.some((dealership) => canonicalDealershipId(dealership.id) === canonicalDealershipId(action.dealershipId)),
  );
  const clusterPolygon = getClusterCoveragePolygon(state, clusterId) || [];
  const dealershipLocations = dealerships.map((dealership) => dealership.location).filter(Boolean);
  const allGeoPoints = [...clusterPolygon, ...dealershipLocations].filter(Boolean);
  const bounds = getBounds(allGeoPoints);

  const rows = dealerships.map((dealership) => {
    const canonicalId = canonicalDealershipId(dealership.id);
    const visit = clusterVisits.find((entry) => canonicalDealershipId(entry.dealershipId) === canonicalId) || null;
    const draft = getDraftForDealership(dealership.id);
    const contact = getLatestContact(dealership.id);
    const media = getLatestMedia(dealership.id);
    const actions = clusterActions.filter((action) => canonicalDealershipId(action.dealershipId) === canonicalId);
    const sentEmail = draft?.status === "sent";
    const emailHandoff = draft?.status === "opened";
    const emailProof = Boolean(sentEmail || emailHandoff);
    const emailIntentLabels = getEmailIntentDetails(draft?.emailIntents || []).map((intent) => intent.label);

    return {
      id: dealership.id,
      name: dealership.name,
      initials: getInitials(dealership.name),
      brands: dealership.brands || [],
      address: dealership.address,
      status: dealership.status || "Not visited",
      statusTone: statusTone(dealership.status),
      leadScore: dealership.leadScore || 0,
      roleHint: dealership.roleHint || "Ask for showroom manager",
      nextAction: dealership.nextAction || "No next action set",
      pitch: dealership.pitch || "",
      location: dealership.location,
      projectedLocation: Array.isArray(dealership.location) ? projectPoint(dealership.location, bounds) : null,
      visit,
      visitTime: formatDateTime(visit?.createdAt),
      outcomes: visit?.outcomes || [],
      note: visit?.note || "",
      draft,
      sentEmail,
      emailHandoff,
      emailProof,
      emailProofLabel: getEmailProofLabel(draft),
      emailProofTime: formatDateTime(draft?.openedAt || draft?.sentAt || draft?.createdAt),
      emailIntentLabels,
      contact,
      media,
      actions,
    };
  });

  const visitedRows = rows.filter((row) => row.visit).sort((left, right) => String(right.visit?.createdAt || "").localeCompare(String(left.visit?.createdAt || "")));
  const warmRows = rows.filter((row) => row.status === "Interested" || row.status === "Site walk booked");
  const sentFollowUps = rows.filter((row) => row.emailProof).length;
  const openActions = clusterActions.filter((action) => action.status === "pending");
  const siteWalks = visitedRows.filter((row) => row.outcomes.includes("Site walk booked"));
  const contactsCaptured = rows.filter((row) => row.contact).length;
  const evidenceCount = rows.reduce((total, row) => total + (row.visit ? 1 : 0) + (row.contact ? 1 : 0) + (row.media ? 1 : 0) + (row.emailProof ? 1 : 0), 0);

  const projectedPolygon = clusterPolygon.map((point) => projectPoint(point, bounds));
  const projectedRoute = dealerships
    .filter((dealership) => Array.isArray(dealership.location))
    .sort((left, right) => (left.order || 999) - (right.order || 999))
    .map((dealership) => projectPoint(dealership.location, bounds));

  const exportDate = new Date();

  return {
    clusterId,
    clusterName: cluster.name,
    exportTitle: `${cluster.name} Cluster Report`,
    exportDateLabel: formatDate(exportDate.toISOString()),
    exportDateIso: exportDate.toISOString(),
    fileName: `${slugify(cluster.name)}-cluster-report-${exportDate.toISOString().slice(0, 10)}.pdf`,
    meta: [
      { label: "Date", value: formatDate(exportDate.toISOString()) },
      { label: "Visited", value: String(visitedRows.length) },
      { label: "Open actions", value: String(openActions.length) },
      { label: "Follow-up proof", value: String(sentFollowUps) },
      { label: "Site walks", value: String(siteWalks.length) },
    ],
    stats: [
      { label: "Visited", value: visitedRows.length, tone: "amber" },
      { label: "Interested", value: warmRows.length, tone: "rose" },
      { label: "Follow-ups due", value: openActions.length, tone: "teal" },
      { label: "Site walks booked", value: siteWalks.length, tone: "mint" },
    ],
    summary: {
      dealershipsVisited: visitedRows.length,
      contactsCaptured,
      evidenceCount,
      sentFollowUps,
    },
    actionsTaken: visitedRows.length
      ? visitedRows.slice(0, 6).map((row) => ({
          title: row.name,
          detail: [
            row.outcomes.length ? row.outcomes.join(", ") : row.nextAction,
            row.emailProof ? `${row.emailProofLabel}: ${row.emailIntentLabels.join(", ") || row.draft?.emailType}` : "",
          ]
            .filter(Boolean)
            .join(". "),
        }))
      : [{ title: "No visits logged", detail: "Visit rows will appear here after route activity is captured." }],
    evidenceGenerated: [
      { label: "Visit logs", value: visitedRows.length },
      { label: "Contact records", value: contactsCaptured },
      { label: "Media captures", value: rows.filter((row) => row.media).length },
      { label: "Email proof events", value: rows.filter((row) => row.emailProof).length },
    ],
    map: {
      width: MAP_WIDTH,
      height: MAP_HEIGHT,
      polygon: projectedPolygon,
      route: projectedRoute,
      points: rows
        .filter((row) => row.projectedLocation)
        .map((row) => ({
          id: row.id,
          name: row.name,
          status: row.status,
          visited: Boolean(row.visit),
          x: row.projectedLocation[0],
          y: row.projectedLocation[1],
        })),
      labels: [
        { text: cluster.name.toUpperCase(), x: 46, y: 50 },
        { text: "BATTERSEA SEARCH", x: MAP_WIDTH - 190, y: MAP_HEIGHT - 30 },
      ],
    },
    dealershipCards: visitedRows.length
      ? visitedRows
      : rows.slice(0, Math.min(rows.length, 4)),
  };
}

export function buildReportPrintUrl(clusterId, options = {}) {
  const params = new URLSearchParams();
  if (clusterId) params.set("cluster", clusterId);
  if (options.autoprint) params.set("autoprint", "1");
  const query = params.toString();
  return `/reports/print${query ? `?${query}` : ""}`;
}
