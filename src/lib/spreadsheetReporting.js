import * as XLSX from "xlsx";

const REPORT_HEADERS = [
  "Stage",
  "Operator",
  "Sector / concept",
  "Location / target",
  "Contact route",
  "Report outcomes",
  "Follow-up status",
  "External report note",
  "Current position",
  "Source / visit date",
  "",
  "Temperature basis",
  "Temp.",
];

const OUTCOME_TRANSLATIONS = {
  Interested: "Positive occupier response recorded",
  "Deferred to decision maker": "Property decision sits outside branch level",
  "Not a good time": "Site visited; follow-up required",
  "Met manager": "Manager-level contact made",
  "Needs email": "Site pack follow-up required",
  "Card captured": "Contact details obtained",
  "Follow-up required": "Follow-up action required",
  "Management not present": "Relevant branch contact unavailable at time of visit",
  "No one present": "No contact available at time of visit",
  "Permanently closed": "Location no longer active",
  "Site walk booked": "Site walk booked",
  "Not suitable": "Not suitable for current requirement",
};

function canonicalId(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function compact(items = []) {
  return items.map((item) => String(item || "").trim()).filter(Boolean);
}

function unique(items = []) {
  return [...new Set(compact(items))];
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = normalizeDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function newest(items = [], dateKeys = ["updatedAt", "createdAt"]) {
  return [...items].sort((left, right) => {
    const leftDate = dateKeys.map((key) => normalizeDate(left?.[key])?.getTime() || 0).find(Boolean) || 0;
    const rightDate = dateKeys.map((key) => normalizeDate(right?.[key])?.getTime() || 0).find(Boolean) || 0;
    return rightDate - leftDate;
  })[0] || null;
}

function sameDealership(left, right) {
  if (!left || !right) return false;
  return canonicalId(left) === canonicalId(right);
}

function latestForDealership(items = [], dealershipId, dateKeys) {
  return newest(items.filter((item) => sameDealership(item.dealershipId, dealershipId)), dateKeys);
}

function allForDealership(items = [], dealershipId) {
  return items.filter((item) => sameDealership(item.dealershipId, dealershipId));
}

function mapPinsByDealership(state) {
  const pins = state?.mapV2?.pins || [];
  const map = new Map();
  for (const pin of pins) {
    const id = pin.legacyDealershipId || pin.dealershipId || pin.id;
    if (id) map.set(canonicalId(id), pin);
  }
  return map;
}

function dealershipRuntimeById(state) {
  const map = new Map();
  for (const dealership of [...(state?.manualDealerships || []), ...(state?.dealerships || [])]) {
    if (dealership?.id) map.set(canonicalId(dealership.id), dealership);
  }
  return map;
}

function getDealershipRecord(state, dealershipId) {
  const runtime = dealershipRuntimeById(state).get(canonicalId(dealershipId)) || {};
  const pin = mapPinsByDealership(state).get(canonicalId(dealershipId)) || {};
  return {
    ...pin,
    ...runtime,
    id: dealershipId,
    name: runtime.name || pin.name || dealershipId,
    address: runtime.address || pin.address || "",
    website: runtime.website || pin.website || "",
    phone: runtime.phone || pin.phone || "",
    sourceType: runtime.sourceType || pin.source || "",
    confidence: runtime.confidence || pin.confidence || "",
  };
}

function getReportSummaryRecords(state) {
  const records = state?.summaryOutcomes || [];
  const included = records.filter((record) => record.includeInReport);
  const source = included.length ? included : records;
  const latestByDealer = new Map();

  for (const record of source) {
    const key = canonicalId(record.dealershipId);
    const current = latestByDealer.get(key);
    const currentDate = normalizeDate(current?.reportIncludedAt || current?.updatedAt)?.getTime() || 0;
    const nextDate = normalizeDate(record.reportIncludedAt || record.updatedAt)?.getTime() || 0;
    if (!current || nextDate >= currentDate) latestByDealer.set(key, record);
  }

  return [...latestByDealer.values()].sort((left, right) => {
    const leftDate = normalizeDate(left.reportIncludedAt || left.updatedAt)?.getTime() || 0;
    const rightDate = normalizeDate(right.reportIncludedAt || right.updatedAt)?.getTime() || 0;
    return rightDate - leftDate;
  });
}

function getOutcomes(summaryRecord, visit) {
  return unique([...(summaryRecord?.labels || []), ...(summaryRecord?.outcomeIds || []), ...(visit?.outcomes || [])]);
}

function translateOutcomes(outcomes = []) {
  return unique(outcomes.map((outcome) => OUTCOME_TRANSLATIONS[outcome] || outcome)).join("; ");
}

function isClosed(outcomes = [], dealership = {}) {
  return outcomes.includes("Permanently closed") || /permanently closed|closed \/ disqualified/i.test(dealership.status || "");
}

function isSiteWalk(outcomes = [], actions = [], dealership = {}) {
  return (
    outcomes.includes("Site walk booked") ||
    /site walk/i.test(dealership.status || "") ||
    actions.some((action) => action.type === "site_walk" || /site walk/i.test(`${action.title || ""} ${action.note || ""}`))
  );
}

function hasPositiveSignal(outcomes = []) {
  return outcomes.includes("Interested");
}

function hasContactRoute({ contact, draft, dealership }) {
  return Boolean(contact?.email || contact?.phone || draft?.toAddress || dealership?.email || dealership?.phone);
}

function getStage({ outcomes, actions, contact, draft, dealership }) {
  if (isClosed(outcomes, dealership)) return 1;
  if (isSiteWalk(outcomes, actions, dealership)) return 6;
  if (hasPositiveSignal(outcomes)) return 4;
  if (hasContactRoute({ contact, draft, dealership }) || outcomes.some((item) => /manager|deferred|follow-up|card/i.test(item))) return 3;
  return 2;
}

function getTemperature({ stage, outcomes, dealership }) {
  if (isClosed(outcomes, dealership) || outcomes.includes("Not suitable")) return "Cold";
  if (stage >= 5) return "Hot";
  if (outcomes.includes("Interested") && outcomes.includes("Needs email") && (outcomes.includes("Card captured") || outcomes.includes("Met manager"))) {
    return "Hot";
  }
  return "Warm";
}

function getTemperatureBasis({ temperature, stage, outcomes }) {
  if (temperature === "Cold") return "Disqualified: location no longer active or no current fit";
  if (stage >= 5) return "Inspection or direct engagement progressed";
  if (temperature === "Hot") return "Strong positive response; follow-up/site pack route established";
  if (outcomes.includes("Interested")) return "Positive occupier response recorded; no formal requirement qualified yet";
  return "Contact route or follow-up pathway established; not disqualified";
}

function contactRoute({ contact, draft, dealership }) {
  const name = contact?.name || draft?.toName || "";
  const role = contact?.role && contact.role !== "Contact pending title" ? contact.role : "";
  const email = contact?.email || draft?.toAddress || "";
  const phone = contact?.phone || dealership?.phone || "";
  const parts = [name, role, email, phone].filter(Boolean);
  if (parts.length) return parts.join(" / ");
  if (dealership?.phone) return dealership.phone;
  return "No contact captured";
}

function sectorFor(dealership = {}) {
  const text = `${dealership.name || ""} ${dealership.brands?.join(" ") || ""} ${dealership.website || ""}`.toLowerCase();
  if (/service|repair|bodyshop|auto centre|motors ltd|car care/.test(text)) return "Automotive service / repair";
  if (/ferrari|lamborghini|bentley|koenigsegg|morgan|macari|fiskens|graeme hunt|prestige|classic/.test(text)) {
    return "Specialist / prestige automotive";
  }
  if (/kia|ford|honda|vauxhall|volkswagen|peugeot|stellantis|bmw|genesis/.test(text)) return "Franchise dealership / main dealer";
  return "Automotive dealership / operator";
}

function locationFor(dealership = {}) {
  return compact([dealership.address, dealership.website]).join("\n");
}

function getFollowupStatus({ draft, actions, stage, outcomes, dealership }) {
  if (isClosed(outcomes, dealership)) return "No follow-up required - location no longer active";
  if (stage >= 5) return "Positive response received; site walk booked";
  if (draft?.status === "sent") return "Follow-up completed; response pending";
  if (draft?.status === "opened") return "Follow-up handoff opened; completion to confirm";
  if (draft?.status === "bounced") return "Outreach attempted; contact route unverified";
  if (outcomes.includes("Needs email") || actions.some((action) => action.type === "email")) return "Follow-up prepared; sending still to confirm";
  if (outcomes.includes("Deferred to decision maker") || outcomes.includes("Management not present")) return "Decision-maker/contact route research required";
  if (outcomes.includes("Follow-up required")) return "Follow-up required before report handover";
  return "Discovery record logged";
}

function displayFollowupStatus(status) {
  if (status === "Follow-up prepared; sending still to confirm") return "Outreach materials prepared; dispatch in progress";
  if (status === "Follow-up required before report handover") return "Follow-up scheduled before report handover";
  if (status === "Decision-maker/contact route research required") return "Decision-maker research underway";
  return status;
}

function currentPosition({ followupStatus, stage, outcomes, dealership }) {
  if (isClosed(outcomes, dealership)) return "Closed / disqualified";
  if (stage >= 5) return "Site walk booked";
  if (followupStatus === "Follow-up completed; response pending") return "Awaiting response";
  if (followupStatus === "Outreach attempted; contact route unverified") return "Contact route being verified";
  if (followupStatus === "Decision-maker/contact route research required") return "Decision-maker research underway";
  if (followupStatus === "Follow-up handoff opened; completion to confirm") return "Outreach in progress";
  if (followupStatus === "Follow-up prepared; sending still to confirm") return "Outreach in progress";
  if (followupStatus === "Follow-up required before report handover") return "Follow-up scheduled";
  return "Discovery logged";
}

function externalNote({ dealership, outcomes, summaryRecord, contact, draft, stage, followupStatus }) {
  const rawNote = String(summaryRecord?.note || "").trim();
  const visitPhrase = dealership.name ? `A physical site visit was conducted at ${dealership.name}` : "A physical site visit was conducted";
  const translated = translateOutcomes(outcomes).toLowerCase();

  if (isClosed(outcomes, dealership)) {
    return rawNote
      ? `${visitPhrase}; the location was confirmed as no longer active for the current outreach route. ${rawNote}`
      : `${visitPhrase}; the location was confirmed as no longer active for the current outreach route. No further action is required for this site.`;
  }

  if (stage >= 5) {
    return `${visitPhrase}, and the opportunity has progressed beyond initial discovery. A positive response has been received and a site walk is booked or being confirmed. The lead is now moving toward inspection-stage engagement.`;
  }

  const parts = [visitPhrase];
  if (outcomes.includes("Met manager")) parts.push("manager-level contact was made");
  if (outcomes.includes("Interested")) parts.push("a positive occupier response was recorded");
  if (outcomes.includes("Deferred to decision maker")) parts.push("property decisions sit outside branch level");
  if (outcomes.includes("Management not present")) parts.push("the relevant management contact was unavailable at the time of visit");
  if (outcomes.includes("Card captured") || contact?.email || contact?.phone) parts.push("contact details were obtained");
  if (outcomes.includes("Needs email")) parts.push("site-pack follow-up is required");

  let sentence = `${parts.join(", ")}.`;
  if (rawNote) sentence += ` ${rawNote}`;
  if (draft?.status === "sent") sentence += " Follow-up has been completed and a response is currently pending.";
  else if (followupStatus.includes("prepared")) sentence += " Outreach materials are prepared and dispatch is in progress.";
  else if (translated.includes("research")) sentence += " Further research is required to establish the appropriate corporate route.";
  sentence += " No formal space requirement, budget, or lease terms have been qualified at this discovery stage.";

  return sentence;
}

export function buildDiscoveryPipelineRows(state = {}) {
  const summaryRecords = getReportSummaryRecords(state);

  return summaryRecords.map((summaryRecord) => {
    const dealershipId = summaryRecord.dealershipId;
    const dealership = getDealershipRecord(state, dealershipId);
    const visit = latestForDealership(state.visits || [], dealershipId, ["createdAt"]);
    const contact = latestForDealership(state.contacts || [], dealershipId, ["updatedAt", "createdAt"]);
    const media = latestForDealership(state.media || [], dealershipId, ["updatedAt", "createdAt"]);
    const draft = latestForDealership(state.emailDrafts || [], dealershipId, ["sentAt", "openedAt", "createdAt"]);
    const actions = allForDealership(state.actions || [], dealershipId);
    const outcomes = getOutcomes(summaryRecord, visit);
    const stage = getStage({ outcomes, actions, contact, draft, dealership });
    const temperature = getTemperature({ stage, outcomes, dealership });
    const followupStatus = getFollowupStatus({ draft, actions, stage, outcomes, dealership });
    const sourceDate = summaryRecord.reportIncludedAt || summaryRecord.updatedAt || visit?.createdAt || draft?.createdAt || media?.createdAt;

    return {
      id: dealershipId,
      stage,
      operator: dealership.name,
      sector: sectorFor(dealership),
      location: locationFor(dealership),
      contactRoute: contactRoute({ contact, draft, dealership }),
      reportOutcomes: translateOutcomes(outcomes),
      followupStatus,
      followupStatusDisplay: displayFollowupStatus(followupStatus),
      externalReportNote: externalNote({ dealership, outcomes, summaryRecord, contact, draft, stage, followupStatus }),
      currentPosition: currentPosition({ followupStatus, stage, outcomes, dealership }),
      source: compact([formatDate(sourceDate), state.syncMeta?.deviceLabel || dealership.sourceType]).join(" / "),
      temperatureBasis: getTemperatureBasis({ temperature, stage, outcomes }),
      temperature,
      rawOutcomes: outcomes,
      rawNote: summaryRecord.note || visit?.note || "",
      contact,
      draft,
    };
  });
}

function sectionRows(rows, section) {
  if (section === "converted") return rows.filter((row) => row.stage >= 5);
  if (section === "hot") return rows.filter((row) => row.temperature === "Hot" && row.stage < 5);
  if (section === "warm") return rows.filter((row) => row.temperature === "Warm" && row.stage >= 3);
  if (section === "pending") return rows.filter((row) => row.temperature === "Warm" && row.stage < 3);
  if (section === "cold") return rows.filter((row) => row.temperature === "Cold");
  return [];
}

function addSection(aoa, title, rows) {
  aoa.push([title]);
  aoa.push(REPORT_HEADERS);
  if (!rows.length) {
    aoa.push(["", "No rows qualified for this section yet."]);
    aoa.push([]);
    return;
  }

  for (const row of rows) {
    aoa.push([
      row.stage,
      row.operator,
      row.sector,
      row.location,
      row.contactRoute,
      row.reportOutcomes,
      row.followupStatusDisplay,
      row.externalReportNote,
      row.currentPosition,
      row.source,
      "",
      row.temperatureBasis,
      row.temperature,
    ]);
  }
  aoa.push([]);
}

function applyWorkbookStyle(ws, aoa) {
  ws["!cols"] = [
    { wch: 8 },
    { wch: 26 },
    { wch: 28 },
    { wch: 36 },
    { wch: 38 },
    { wch: 44 },
    { wch: 34 },
    { wch: 74 },
    { wch: 26 },
    { wch: 26 },
    { wch: 3 },
    { wch: 46 },
    { wch: 10 },
  ];
  ws["!freeze"] = { xSplit: 0, ySplit: 8 };

  for (let rowIndex = 0; rowIndex < aoa.length; rowIndex += 1) {
    const row = aoa[rowIndex] || [];
    const isTitle = rowIndex === 0;
    const isSection = row.length === 1 && row[0] && rowIndex > 7;
    const isHeader = row[0] === "Stage" && row[1] === "Operator";

    for (let colIndex = 0; colIndex < REPORT_HEADERS.length; colIndex += 1) {
      const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
      const cell = ws[cellAddress];
      if (!cell) continue;
      cell.s = {
        alignment: { vertical: "top", wrapText: true },
        font: { name: "Aptos", sz: isTitle ? 16 : 10, bold: isTitle || isSection || isHeader },
        border: {
          top: { style: "thin", color: { rgb: "D9D9D9" } },
          bottom: { style: "thin", color: { rgb: "D9D9D9" } },
          left: { style: "thin", color: { rgb: "D9D9D9" } },
          right: { style: "thin", color: { rgb: "D9D9D9" } },
        },
        fill: isSection
          ? { patternType: "solid", fgColor: { rgb: "E7E6E6" } }
          : isHeader
            ? { patternType: "solid", fgColor: { rgb: "D9EAD3" } }
            : undefined,
      };
      if (colIndex === 12 && cell.v === "Hot") cell.s.fill = { patternType: "solid", fgColor: { rgb: "F4CCCC" } };
      if (colIndex === 12 && cell.v === "Warm") cell.s.fill = { patternType: "solid", fgColor: { rgb: "FCE5CD" } };
      if (colIndex === 12 && cell.v === "Cold") cell.s.fill = { patternType: "solid", fgColor: { rgb: "D9D9D9" } };
      if (colIndex === 6 && String(cell.v || "").includes("completed")) cell.s.fill = { patternType: "solid", fgColor: { rgb: "DDEBF7" } };
    }
  }
}

export function buildDiscoveryPipelineWorkbook(state = {}, options = {}) {
  const rows = buildDiscoveryPipelineRows(state);
  const generatedAt = options.generatedAt ? new Date(options.generatedAt) : new Date();
  const generatedLabel = formatDate(generatedAt.toISOString());
  const completed = rows.filter((row) => row.currentPosition === "Awaiting response").length;
  const open = rows.filter((row) => !["Awaiting response", "Closed / disqualified", "Site walk booked"].includes(row.currentPosition)).length;

  const aoa = [
    ["DISCOVERY PIPELINE"],
    ["Property:", options.propertyName || "Steel Works / Battersea", "", "", "", "", "", "", "DISCOVERY SUMMARY"],
    ["Client:", options.clientName || "AVANTON / senior team reporting", "", "", "", "", "", "", "Hot", rows.filter((row) => row.temperature === "Hot").length],
    ["Report type:", "Stage 0-6 occupier discovery pipeline", "", "", "", "", "", "", "Warm", rows.filter((row) => row.temperature === "Warm").length],
    ["Date of update:", generatedLabel, "", "", "", "", "", "", "Cold / disqualified", rows.filter((row) => row.temperature === "Cold").length],
    ["Position:", "JSON-backed field input to spreadsheet reporting", "", "", "", "", "", "", "Visited/report rows", rows.length],
    ["Follow-up control:", "Report-safe status distinguishes completed / response pending from outstanding follow-up", "", "", "", "", "", "", "Awaiting response", completed],
    ["", "", "", "", "", "", "", "", "Open follow-up / verification", open],
    [],
  ];

  addSection(aoa, "Converted / Agency Pipeline (Stage 5-7)", sectionRows(rows, "converted"));
  addSection(aoa, "Hot Discovery Signals (Stage 4)", sectionRows(rows, "hot"));
  addSection(aoa, "Warm Discovery Prospects (Stages 3-4)", sectionRows(rows, "warm"));
  addSection(aoa, "Contact Route Pending / Research Required (Stages 1-2)", sectionRows(rows, "pending"));
  addSection(aoa, "Cold / Disqualified Targets", sectionRows(rows, "cold"));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  applyWorkbookStyle(ws, aoa);
  XLSX.utils.book_append_sheet(wb, ws, "Discovery Pipeline");

  const definitions = [
    ["Stage", "Label", "Definition"],
    ["0", "Target hypothesis", "Sector/operator type may fit the premises; target universe still being built."],
    ["1", "Target identified", "Specific operator/location identified for desk review or field route."],
    ["2", "Field visit / desk review completed", "Site/location checked, closure/relocation/availability observed, or no one present."],
    ["3", "Contact route found", "Manager, owner, head office, property contact, card/email, or referral path captured."],
    ["4", "Interest / relevance signal", "Site pack requested, positive conversation, follow-up requested, or operational fit established."],
    ["5", "Requirement qualified", "Budget, timing, size, use, power/access needs or expansion requirement confirmed."],
    ["6", "Inspection / formal engagement", "Occupier or property decision-maker agrees to formal site inspection or direct engagement."],
    ["7", "Commercial terms / offer", "Commercial discussion, offer, heads of terms, under offer, or agency-style pipeline stage."],
  ];
  const definitionsWs = XLSX.utils.aoa_to_sheet(definitions);
  definitionsWs["!cols"] = [{ wch: 12 }, { wch: 34 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(wb, definitionsWs, "Definitions");

  const raw = [["Operator", "Raw outcomes", "Raw note", "External report note", "Contact route", "Follow-up status"]].concat(
    rows.map((row) => [
      row.operator,
      row.rawOutcomes.join("; "),
      row.rawNote,
      row.externalReportNote,
      row.contactRoute,
      row.followupStatusDisplay,
    ]),
  );
  const rawWs = XLSX.utils.aoa_to_sheet(raw);
  rawWs["!cols"] = [{ wch: 28 }, { wch: 44 }, { wch: 70 }, { wch: 90 }, { wch: 44 }, { wch: 34 }];
  XLSX.utils.book_append_sheet(wb, rawWs, "Internal Raw Notes");

  return { workbook: wb, rows };
}

export function buildDiscoveryPipelineWorkbookBuffer(state = {}, options = {}) {
  const { workbook, rows } = buildDiscoveryPipelineWorkbook(state, options);
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx", cellStyles: true });
  return { buffer, rows };
}

export function buildDiscoveryPipelineFileName(options = {}) {
  const date = options.date || new Date().toISOString().slice(0, 10);
  return `lead-helper-discovery-pipeline-${date}.xlsx`;
}
