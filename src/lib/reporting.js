import { canonicalDealershipId, getClusterCoveragePolygon, getEmailIntentDetails } from "./leadHelperModel";
import { getMapV2BoundaryForPins } from "./mapV2Model";

const MAP_WIDTH = 980;
const MAP_HEIGHT = 320;
const MAP_PADDING = 30;
const clusterColourMap = {
  amber: "#f3a53d",
  mint: "#7ae3b8",
  rose: "#ff7fa7",
  teal: "#2fd4d4",
  lime: "#b8de6f",
  violet: "#d8a7ff",
  cyan: "#53d7ff",
  coral: "#ff9b73",
  blue: "#80b7ff",
  gold: "#f0df88",
  orchid: "#e58cff",
  slate: "#9aa7b8",
};

const dealershipReportColours = [
  "#7ae3b8",
  "#ff7fa7",
  "#2fd4d4",
  "#f3a53d",
  "#d8a7ff",
  "#f0df88",
  "#80b7ff",
  "#ff9b73",
];

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sameTextIdentity(left, right) {
  return slugify(left) === slugify(right);
}

export function getReportClusters(state) {
  const mapClusters = state?.mapV2?.clusters || [];
  return mapClusters.length ? mapClusters : state?.clusters || [];
}

export function getReportPinsForCluster(state, clusterId) {
  const mapV2 = state?.mapV2;
  if (!mapV2?.pins?.length) return [];
  const assignedPinIds = new Set(
    (mapV2.assignments || [])
      .filter((assignment) => assignment.clusterId === clusterId && assignment.assignmentType !== "rejected")
      .map((assignment) => assignment.pinId),
  );
  return mapV2.pins.filter((pin) => assignedPinIds.has(pin.id));
}

export function isMapV2ReportCluster(state, clusterId) {
  return Boolean(state?.mapV2?.clusters?.some((cluster) => cluster.id === clusterId));
}

function getClusterReportEvidenceScore(state, cluster) {
  const clusterId = cluster?.id;
  const reportPins = getReportPinsForCluster(state, clusterId);
  const pinDealershipIds = new Set(
    reportPins
      .map((pin) => pin.legacyDealershipId || pin.dealershipId || pin.id)
      .filter(Boolean)
      .map((id) => canonicalDealershipId(id)),
  );
  const isPinnedDealership = (dealershipId) => pinDealershipIds.has(canonicalDealershipId(dealershipId));
  const visits = (state?.visits || []).filter((visit) => visit.clusterId === clusterId || isPinnedDealership(visit.dealershipId)).length;
  const contacts = (state?.contacts || []).filter((contact) => isPinnedDealership(contact.dealershipId)).length;
  const emails = (state?.emailDrafts || []).filter((draft) => isPinnedDealership(draft.dealershipId) && draft.status !== "archived").length;
  const actions = (state?.actions || []).filter((action) => isPinnedDealership(action.dealershipId)).length;

  return visits * 100 + contacts * 45 + emails * 35 + actions * 20 + reportPins.length;
}

export function getDefaultReportClusterId(state) {
  const clusters = getReportClusters(state);
  const rankedByEvidence = clusters
    .map((cluster, index) => ({
      cluster,
      index,
      score: getClusterReportEvidenceScore(state, cluster),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  return rankedByEvidence.find((item) => item.score > 0)?.cluster.id || clusters.find((cluster) => getReportPinsForCluster(state, cluster.id).length)?.id || clusters[0]?.id || "";
}

export function buildDealershipsFromReportPins({ pins = [], clusterId, allDealerships = [], getDealershipById }) {
  return pins.map((pin, index) => {
    const matchedById = pin.legacyDealershipId ? getDealershipById?.(pin.legacyDealershipId) : null;
    const matchedByIdentity =
      matchedById?.id
        ? null
        : allDealerships.find(
            (dealership) =>
              (pin.name && sameTextIdentity(dealership.name, pin.name)) ||
              (pin.address && sameTextIdentity(dealership.address, pin.address)),
          );
    const matched = matchedById?.id ? matchedById : matchedByIdentity || {};
    const id = matched.id || pin.legacyDealershipId || pin.id;

    return {
      ...matched,
      id,
      clusterId,
      order: matched.order || index + 1,
      name: matched.name || pin.name,
      shortName: matched.shortName || pin.name?.split(/\s+/).slice(0, 2).join(" ") || "Map pin",
      address: matched.address || pin.address || "Address not captured",
      roleHint: matched.roleHint || "Ask for showroom manager or dealer principal",
      contactHint: matched.contactHint || "Decision-maker not yet confirmed",
      parentGroup: matched.parentGroup || "Dealership",
      brands: matched.brands?.length ? matched.brands : pin.brands || [],
      phone: matched.phone || pin.phone || "",
      website: matched.website || pin.website || "",
      pitch: matched.pitch || "Map pin selected for field coverage.",
      location: Array.isArray(pin.location) ? pin.location : matched.location || null,
      sourceType: matched.sourceType || pin.source || "map-v2",
      status: matched.status || "Not visited",
      leadScore: Number(matched.leadScore ?? 0),
      nextAction: matched.nextAction || "Visit and capture contact details",
      mapPinId: pin.id,
    };
  });
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

function formatLogDate(value) {
  if (!value) return "";
  const normalized = String(value).replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return formatDate(value);
  return formatDate(date.toISOString());
}

function parseReportDate(value) {
  if (!value) return null;
  const normalized = String(value).replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatReportDateRange(values = [], fallbackDate = new Date()) {
  const timestamps = values
    .map(parseReportDate)
    .filter(Boolean)
    .map((date) => date.getTime())
    .sort((left, right) => left - right);

  if (!timestamps.length) {
    return {
      iso: fallbackDate.toISOString(),
      label: formatDate(fallbackDate.toISOString()),
      slug: fallbackDate.toISOString().slice(0, 10),
    };
  }

  const first = new Date(timestamps[0]);
  const last = new Date(timestamps[timestamps.length - 1]);
  const firstSlug = first.toISOString().slice(0, 10);
  const lastSlug = last.toISOString().slice(0, 10);

  return {
    iso: first.toISOString(),
    label: firstSlug === lastSlug ? formatDate(first.toISOString()) : `${formatDate(first.toISOString())} - ${formatDate(last.toISOString())}`,
    slug: firstSlug === lastSlug ? firstSlug : `${firstSlug}-to-${lastSlug}`,
  };
}

function formatClusterReportTitle(clusterName) {
  const name = String(clusterName || "Cluster").trim();
  return /\bcluster\b/i.test(name) ? `${name} Report` : `${name} Cluster Report`;
}

function formatClusterCoverageTitle(clusterName) {
  const name = String(clusterName || "Cluster").trim();
  return /\bcluster\b/i.test(name) ? `${name} coverage` : `${name} cluster coverage`;
}

function getEmailProofLabel(draft) {
  if (!draft) return "Not started";
  if (draft.proofLabel) return draft.proofLabel;
  if (draft.status === "sent") return "Sent";
  if (draft.status === "opened") return "Outlook opened";
  return "Draft ready";
}

function isPlaceholderContactRole(role) {
  return !role || String(role).trim().toLowerCase() === "contact pending title";
}

function formatRecipient(contact, draft) {
  const name = contact?.name || draft?.toName || draft?.toAddress || "contact";
  return !isPlaceholderContactRole(contact?.role) ? `${name} - ${contact.role}` : name;
}

function getActionPhraseFromIntent(label) {
  const normalized = String(label || "").toLowerCase();
  if (normalized.includes("brochure")) return "brochure and site details to follow";
  if (normalized.includes("site pack")) return "Battersea site pack offered";
  if (normalized.includes("site walk")) return "pre-site-walk information to be sent";
  if (normalized.includes("decision")) return "decision-maker intro requested";
  if (normalized.includes("team member")) return "relevant team member to be picked up with when available";
  if (normalized.includes("check back")) return "email thread kept warm for the next check-in";
  if (normalized.includes("close")) return "lead politely closed for now";
  if (normalized.includes("instant")) return "same-day follow-up completed";
  return label;
}

function getActionPhraseFromOutcome(outcome) {
  const normalized = String(outcome || "").toLowerCase();
  if (normalized.includes("site walk")) return "site walk booked or being confirmed";
  if (normalized.includes("deferred")) return "awaiting decision-maker feedback or introduction";
  if (normalized.includes("not a good time")) return "return visit or call required at a better time";
  if (normalized.includes("management not present")) return "manager contact to be chased";
  if (normalized.includes("follow-up")) return "wider team follow-up required";
  if (normalized.includes("needs email")) return "Battersea site information to be sent by email";
  if (normalized.includes("not suitable")) return "not suitable for current requirement";
  if (normalized.includes("interested")) return "interest in the Battersea site recorded";
  if (normalized.includes("manager")) return "manager-level contact made";
  if (normalized.includes("card")) return "business card captured and contact details logged";
  return outcome;
}

function getReportChipLabel(outcome) {
  const normalized = String(outcome || "").toLowerCase();
  if (normalized.includes("site walk")) return "Site walk";
  if (normalized.includes("deferred")) return "Decision-maker review";
  if (normalized.includes("not a good time")) return "Better time needed";
  if (normalized.includes("management not present")) return "Manager absent";
  if (normalized.includes("follow-up")) return "Follow-up set";
  if (normalized.includes("needs email")) return "Site pack needed";
  if (normalized.includes("not suitable")) return "Not suitable";
  if (normalized.includes("interested")) return "Interest logged";
  if (normalized.includes("manager")) return "Manager met";
  if (normalized.includes("card")) return "Contact logged";
  return outcome;
}

function dedupeList(items) {
  return [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))];
}

function isInternalVisitNote(note) {
  const normalized = String(note || "").toLowerCase();
  return (
    !normalized ||
    normalized.includes("outlook draft opened") ||
    normalized.includes("fgi email") ||
    normalized.includes("email page")
  );
}

const reportOutcomeOrder = [
  "Met manager",
  "Interested",
  "Needs email",
  "Follow-up required",
  "Not a good time",
  "Management not present",
  "Deferred to decision maker",
  "Card captured",
  "Site walk booked",
  "Not suitable",
];

function formatContactName(contact) {
  return contact?.name || "the on-site contact";
}

function formatContactTitle(contact) {
  return !isPlaceholderContactRole(contact?.role) ? contact.role : "title not captured";
}

function formatContactWithTitle(contact) {
  return contact?.name ? `${formatContactName(contact)} (${formatContactTitle(contact)})` : "the on-site contact";
}

function getSiteWalkDateLabel(actions = []) {
  const siteWalkAction = actions.find((action) => action.type === "site_walk" && action.dueAt);
  return siteWalkAction?.dueAt ? formatDateTime(siteWalkAction.dueAt) : "";
}

function getReportSentenceForOutcome(outcome, { contact, actions = [] }) {
  const siteWalkDate = getSiteWalkDateLabel(actions);

  if (outcome === "Met manager") {
    return `Had a productive initial conversation with the site manager, ${formatContactWithTitle(contact)}, to pitch the new commercial space and gauge their interest in expanding their footprint.`;
  }

  if (outcome === "Interested") {
    return "The team expressed strong interest in the new commercial space and see clear value in the proposed location.";
  }

  if (outcome === "Needs email") {
    return "They requested further information, so I am sending over the comprehensive site pack and proposal details via email for their review.";
  }

  if (outcome === "Follow-up required") {
    return "Initial contact was made, but additional members of their team need to be included before the opportunity can progress.";
  }

  if (outcome === "Not a good time") {
    return "The timing was not suitable for a detailed conversation, so this location needs a return visit or follow-up call at a better time.";
  }

  if (outcome === "Management not present") {
    return "Management was not present, so the relevant decision-maker needs to be chased before the lead can be properly qualified.";
  }

  if (outcome === "Deferred to decision maker") {
    return "Spoke with the on-site team, but they directed me to senior team members for any property expansion approvals.";
  }

  if (outcome === "Card captured") {
    return `Secured contact details for ${formatContactWithTitle(contact)} and added them to the operational contact list for future correspondence.`;
  }

  if (outcome === "Site walk booked") {
    return siteWalkDate
      ? `Arranged a formal site walk for ${siteWalkDate} to tour the proposed space and discuss layout possibilities.`
      : "Arranged a formal site walk to tour the proposed space and discuss layout possibilities.";
  }

  if (outcome === "Not suitable") {
    return "The site does not align with the company's current expansion criteria; no further action will be taken on this location.";
  }

  return getActionPhraseFromOutcome(outcome);
}

function orderOutcomes(outcomes = []) {
  return [...outcomes].sort((left, right) => {
    const leftIndex = reportOutcomeOrder.indexOf(left);
    const rightIndex = reportOutcomeOrder.indexOf(right);
    return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
  });
}

function buildChipReportText({ outcomes = [], contact, actions = [] }) {
  const sentences = orderOutcomes(outcomes).map((outcome) => getReportSentenceForOutcome(outcome, { contact, actions }));
  return dedupeList(sentences).join(" ");
}

function buildVisitReportNote({ note, outcomes = [], contact, actions = [] }) {
  if (!isInternalVisitNote(note)) return note;
  return buildChipReportText({ outcomes, contact, actions });
}

function getRowEvidenceTimestamp({ visit, summaryRecord, draft, media, completedActions = [] }) {
  return (
    visit?.createdAt ||
    summaryRecord?.reportIncludedAt ||
    summaryRecord?.updatedAt ||
    media?.createdAt ||
    draft?.openedAt ||
    draft?.sentAt ||
    draft?.createdAt ||
    completedActions[0]?.completedAt ||
    ""
  );
}

function buildOutcomeReportSummary({ outcomes = [], contact, actions = [] }) {
  return buildChipReportText({ outcomes, contact, actions });
}

export function buildEmailProofSummary({ draft, contact, dealership, emailIntentLabels = [], outcomes = [] }) {
  if (!draft) {
    return {
      label: "No email evidence yet",
      headline: "No email evidence yet",
      detail: "No follow-up email action has been recorded for this dealership.",
      actions: [],
    };
  }

  if (draft.status !== "sent" && draft.status !== "opened") {
    return {
      label: "Draft ready",
      headline: `Draft prepared for ${formatRecipient(contact, draft)}`,
      detail: `Draft prepared for the ${dealership.name} follow-up, but no handoff to Outlook has been recorded yet.`,
      actions: dedupeList(emailIntentLabels.map(getActionPhraseFromIntent)),
    };
  }

  const recipient = formatRecipient(contact, draft);
  const proofVerb = draft.status === "sent" ? "Email sent to" : "Emailed";
  const label = `${proofVerb} ${recipient}`;
  const actionPhrases = dedupeList([
    ...emailIntentLabels.map(getActionPhraseFromIntent),
    ...outcomes.map(getActionPhraseFromOutcome),
  ]);
  const actionSentence = actionPhrases.length ? `Recorded next steps: ${actionPhrases.join("; ")}.` : "";

  return {
    label,
    headline: label,
    detail: [`Followed up from the showroom conversation at ${dealership.name}.`, actionSentence].filter(Boolean).join(" "),
    actions: actionPhrases,
  };
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

  if (points.length === 1) {
    const [lat, lng] = points[0];
    return {
      minLat: lat - 0.005,
      maxLat: lat + 0.005,
      minLng: lng - 0.005,
      maxLng: lng + 0.005,
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

function getReportClusterColour(cluster) {
  return clusterColourMap[cluster?.colour] || "#f3a53d";
}

function getDealershipReportColour(dealership, index) {
  const identity = slugify(`${dealership?.name || ""} ${dealership?.id || ""}`);
  if (identity.includes("west4-auto-centre") || identity.includes("west-4-auto-centre") || identity.includes("west4")) {
    return "#7ae3b8";
  }

  const nonGreenColours = dealershipReportColours.filter((colour) => colour !== "#7ae3b8");
  return nonGreenColours[index % nonGreenColours.length];
}

export function buildClusterReportModel({
  state,
  cluster,
  dealerships,
  mapPins = [],
  getDraftForDealership,
  getLatestContact,
  getLatestMedia,
}) {
  const clusterId = cluster.id;
  const dealershipIds = new Set(dealerships.map((dealership) => canonicalDealershipId(dealership.id)));
  const clusterVisits = state.visits.filter(
    (visit) => visit.clusterId === clusterId || dealershipIds.has(canonicalDealershipId(visit.dealershipId)),
  );
  const clusterActions = state.actions.filter((action) =>
    dealerships.some((dealership) => canonicalDealershipId(dealership.id) === canonicalDealershipId(action.dealershipId)),
  );
  const mapV2Polygon = getMapV2BoundaryForPins(mapPins);
  const usingMapV2Pins = mapPins.length > 0;
  const clusterPolygon = mapV2Polygon.length ? mapV2Polygon : usingMapV2Pins ? [] : getClusterCoveragePolygon(state, clusterId) || [];
  const dealershipLocations = dealerships.map((dealership) => dealership.location).filter(Boolean);
  const allGeoPoints = [...clusterPolygon, ...dealershipLocations, ...mapPins.map((pin) => pin.location)].filter(Boolean);
  const bounds = getBounds(allGeoPoints);

  const rows = dealerships.map((dealership, index) => {
    const canonicalId = canonicalDealershipId(dealership.id);
    const reportColour = getDealershipReportColour(dealership, index);
    const visit = clusterVisits.find((entry) => canonicalDealershipId(entry.dealershipId) === canonicalId) || null;
    const draft = getDraftForDealership(dealership.id);
    const contact = getLatestContact(dealership.id);
    const media = getLatestMedia(dealership.id);
    const actions = clusterActions.filter((action) => canonicalDealershipId(action.dealershipId) === canonicalId);
    const completedActions = actions.filter((action) => action.status === "done");
    const summaryRecord = (state.summaryOutcomes || []).find((item) => canonicalDealershipId(item.dealershipId) === canonicalId) || null;
    const sentEmail = draft?.status === "sent";
    const emailHandoff = draft?.status === "opened";
    const emailProof = Boolean(sentEmail || emailHandoff);
    const emailIntentLabels = getEmailIntentDetails(draft?.emailIntents || []).map((intent) => intent.label);
    const emailProofSummary = buildEmailProofSummary({
      draft,
      contact,
      dealership,
      emailIntentLabels,
      outcomes: visit?.outcomes || [],
    });
    const outcomeSummary = buildOutcomeReportSummary({
      outcomes: visit?.outcomes || [],
      contact,
      actions,
    });
    const visitReportNote = buildVisitReportNote({
      note: visit?.note || "",
      outcomes: visit?.outcomes || [],
      contact,
      actions,
    });
    const evidenceTimestamp = getRowEvidenceTimestamp({ visit, summaryRecord, draft, media, completedActions });

    return {
      id: dealership.id,
      name: dealership.name,
      reportColour,
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
      visitDate: formatLogDate(visit?.createdAt),
      evidenceDate: evidenceTimestamp,
      evidenceDateLabel: formatLogDate(evidenceTimestamp),
      outcomes: visit?.outcomes || [],
      reportOutcomeLabels: (visit?.outcomes || []).map(getReportChipLabel),
      outcomeSummary,
      note: visitReportNote,
      draft,
      sentEmail,
      emailHandoff,
      emailProof,
      emailProofLabel: emailProof ? emailProofSummary.label : getEmailProofLabel(draft),
      emailProofHeadline: emailProofSummary.headline,
      emailProofDetail: emailProofSummary.detail,
      emailProofDate: formatLogDate(draft?.openedAt || draft?.sentAt || draft?.createdAt),
      emailIntentLabels,
      emailProofActions: emailProofSummary.actions,
      contact,
      media,
      actions,
      completedActions,
      summaryRecord,
      summaryLabels: summaryRecord?.labels || [],
    };
  });

  const visitedRows = rows.filter((row) => row.visit).sort((left, right) => String(right.visit?.createdAt || "").localeCompare(String(left.visit?.createdAt || "")));
  const approvedReportRows = rows
    .filter((row) => row.summaryRecord?.includeInReport)
    .sort((left, right) => String(right.summaryRecord?.reportIncludedAt || "").localeCompare(String(left.summaryRecord?.reportIncludedAt || "")));
  const fallbackReportRows = rows
    .filter((row) => row.visit || row.completedActions.length || row.summaryLabels.length)
    .sort((left, right) => {
      const leftDate = left.visit?.createdAt || left.completedActions[0]?.completedAt || left.summaryRecord?.updatedAt || "";
      const rightDate = right.visit?.createdAt || right.completedActions[0]?.completedAt || right.summaryRecord?.updatedAt || "";
      return String(rightDate).localeCompare(String(leftDate));
    });
  const reportableRows = approvedReportRows.length ? approvedReportRows : fallbackReportRows;
  const warmRows = rows.filter((row) => row.status === "Interested" || row.status === "Site walk booked");
  const sentFollowUps = rows.filter((row) => row.emailProof).length;
  const openActions = clusterActions.filter((action) => action.status === "pending");
  const contactsCaptured = rows.filter((row) => row.contact).length;
  const evidenceCount = rows.reduce((total, row) => total + (row.visit ? 1 : 0) + (row.contact ? 1 : 0) + (row.media ? 1 : 0) + (row.emailProof ? 1 : 0), 0);

  const projectedPolygon = clusterPolygon.map((point) => projectPoint(point, bounds));
  const projectedRoute = dealerships
    .filter((dealership) => Array.isArray(dealership.location))
    .sort((left, right) => (left.order || 999) - (right.order || 999))
    .map((dealership) => projectPoint(dealership.location, bounds));

  const exportDate = new Date();
  const reportDate = formatReportDateRange(reportableRows.map((row) => row.evidenceDate), exportDate);

  return {
    clusterId,
    clusterName: cluster.name,
    exportTitle: formatClusterReportTitle(cluster.name),
    coverageTitle: formatClusterCoverageTitle(cluster.name),
    exportDateLabel: reportDate.label,
    exportDateIso: reportDate.iso,
    generatedDateLabel: formatDate(exportDate.toISOString()),
    fileName: `${slugify(cluster.name)}-cluster-report-${reportDate.slug}.pdf`,
    meta: [
      { label: "Date", value: reportDate.label },
      { label: "Visited", value: String(visitedRows.length) },
      { label: "Open actions", value: String(openActions.length) },
      { label: "Follow-ups", value: String(sentFollowUps) },
    ],
    stats: [
      { label: "Visited", value: visitedRows.length, tone: "amber" },
      { label: "Interested", value: warmRows.length, tone: "rose" },
      { label: "Follow-ups due", value: openActions.length, tone: "teal" },
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
          colour: row.reportColour,
          detail: row.outcomeSummary || row.emailProofDetail || row.nextAction,
        }))
      : [{ title: "No visits logged", detail: "Visit rows will appear here after route activity is captured." }],
    evidenceGenerated: [
      { label: "Visit logs", value: visitedRows.length },
      { label: "Contact records", value: contactsCaptured },
      { label: "Media captures", value: rows.filter((row) => row.media).length },
      { label: "Follow-up records", value: rows.filter((row) => row.emailProof).length },
    ],
    map: {
      width: MAP_WIDTH,
      height: MAP_HEIGHT,
      sourceLabel: usingMapV2Pins ? "Map pin assignments" : "Operational cluster data",
      polygon: projectedPolygon,
      route: projectedRoute,
      leaflet: {
        colour: getReportClusterColour(cluster),
        polygon: clusterPolygon,
        route: dealerships
          .filter((dealership) => Array.isArray(dealership.location))
          .sort((left, right) => (left.order || 999) - (right.order || 999))
          .map((dealership) => dealership.location),
        points: rows
          .filter((row) => Array.isArray(row.location))
          .map((row) => ({
            id: row.id,
            name: row.name,
            colour: row.reportColour,
            status: row.status,
            visited: Boolean(row.visit),
            location: row.location,
          })),
      },
      points: rows
        .filter((row) => row.projectedLocation)
        .map((row) => ({
          id: row.id,
          name: row.name,
          colour: row.reportColour,
          status: row.status,
          visited: Boolean(row.visit),
          x: row.projectedLocation[0],
          y: row.projectedLocation[1],
        })),
      labels: [
        { text: cluster.name.toUpperCase(), x: 46, y: 50 },
        { text: usingMapV2Pins ? "PIN-FIRST FIELD CLUSTER" : "BATTERSEA SEARCH", x: MAP_WIDTH - 250, y: MAP_HEIGHT - 30 },
      ],
    },
    dealershipCards: reportableRows.length ? reportableRows : rows.slice(0, Math.min(rows.length, 4)),
  };
}

export function buildReportPrintUrl(clusterId, options = {}) {
  const params = new URLSearchParams();
  if (clusterId) params.set("cluster", clusterId);
  if (options.autoprint) params.set("autoprint", "1");
  const query = params.toString();
  return `/reports/print${query ? `?${query}` : ""}`;
}

export function buildReportPdfUrl(clusterId) {
  const params = new URLSearchParams();
  if (clusterId) params.set("cluster", clusterId);
  const query = params.toString();
  return `/api/reports/pdf${query ? `?${query}` : ""}`;
}
