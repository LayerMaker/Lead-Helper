import fs from "node:fs";
import path from "node:path";

const statePath =
  process.argv[2] ||
  "C:/Users/crock/Documents/Lead-Helper/WebApp/lead-helper-backup-2026-07-03-corrected.json";
const outputPath = process.argv[3] || "output/audit/dealership-cluster-verification-audit.csv";

const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const clusters = state.mapV2?.clusters || [];
const pins = state.mapV2?.pins || [];
const assignments = state.mapV2?.assignments || [];
const visits = state.visits || [];
const runtimeDealerships = state.dealerships || [];
const contacts = state.contacts || [];

function csv(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function getDealershipId(pin) {
  return pin.legacyDealershipId || pin.dealershipId || pin.id;
}

function fieldStatusFor(pin) {
  const dealershipId = getDealershipId(pin);
  const visit = visits.find((item) => item.dealershipId === dealershipId);
  const runtime = runtimeDealerships.find((item) => item.id === dealershipId);

  if (runtime?.status === "Permanently closed" || visit?.outcomes?.includes("Permanently closed")) {
    return "field-confirmed permanently closed";
  }
  if (runtime?.status === "Visited - closed" || visit?.outcomes?.includes("Closed today")) {
    return "field-confirmed closed on arrival";
  }
  if (visit) return "field-visited";
  return "unchecked";
}

function decisionFor(status) {
  if (status.includes("permanently")) return "remove from active route";
  if (status.includes("closed on arrival")) return "verify opening before revisit";
  if (status === "field-visited") return "visited - keep evidence";
  return "needs verification before field visit";
}

const rows = [
  [
    "cluster_id",
    "cluster_name",
    "pin_id",
    "dealership_id",
    "name",
    "address",
    "website",
    "phone",
    "source",
    "confidence",
    "lat",
    "lng",
    "field_status",
    "route_decision",
    "visited_count",
    "contact_count",
    "verification_notes",
    "evidence_needed",
  ],
];

for (const pin of pins) {
  const assignment = assignments.find((item) => item.pinId === pin.id && item.assignmentType !== "rejected");
  const cluster = clusters.find((item) => item.id === assignment?.clusterId);
  const dealershipId = getDealershipId(pin);
  const fieldStatus = fieldStatusFor(pin);

  rows.push([
    assignment?.clusterId || "",
    cluster?.name || "Unassigned",
    pin.id,
    dealershipId,
    pin.name,
    pin.address,
    pin.website,
    pin.phone,
    pin.source,
    pin.confidence,
    Array.isArray(pin.location) ? pin.location[0] : "",
    Array.isArray(pin.location) ? pin.location[1] : "",
    fieldStatus,
    decisionFor(fieldStatus),
    visits.filter((item) => item.dealershipId === dealershipId).length,
    contacts.filter((item) => item.dealershipId === dealershipId).length,
    "",
    "Google Maps live listing; website/contact page; phone call if uncertain; street-view/signage check",
  ]);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, rows.map((row) => row.map(csv).join(",")).join("\n"));
console.log(outputPath);
