import { useMemo, useState } from "react";
import { AppLayout } from "../components/AppLayout";
import { buildReportPdfUrl, getReportClusters } from "../lib/reporting";
import { useAppState } from "../state/AppState";

const clusterAccentMap = {
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

const summaryOutcomeCatalog = [
  {
    id: "no_response_yet",
    label: "No response yet",
    createChaseAction: true,
    chaseTitle: "Chase site pack response",
    chaseNote: "No response recorded during weekly summary review.",
  },
  { id: "responded", label: "Responded" },
  { id: "interested", label: "Interested" },
  { id: "not_good_fit", label: "Not a good fit" },
  { id: "sharing_with_team", label: "Sharing with team" },
  { id: "decision_maker_requested", label: "Decision maker requested" },
  { id: "teams_call_booked", label: "Teams call booked" },
  { id: "site_walk_booked", label: "Site walk booked" },
  {
    id: "chase_next_week",
    label: "Chase next week",
    createChaseAction: true,
    chaseTitle: "Chase weekly follow-up",
    chaseNote: "Follow-up requested from weekly summary review.",
  },
];

function formatDateLabel(value) {
  if (!value) return "No date";
  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatCompletedAction(action) {
  const label = action.completedLabel || action.title || "Completed action";
  const completedAt = action.completedAt ? ` - ${formatDateLabel(action.completedAt)}` : "";
  return `${label}${completedAt}`;
}

function getEntryDate(entry) {
  return entry.latestVisit?.createdAt || entry.completedActions[0]?.completedAt || "";
}

function getClusterAccent(cluster) {
  if (cluster?.colour) return clusterAccentMap[cluster.colour] || "#f3a53d";
  if (cluster?.colorClass?.includes("mint")) return clusterAccentMap.mint;
  if (cluster?.colorClass?.includes("rose")) return clusterAccentMap.rose;
  if (cluster?.colorClass?.includes("teal")) return clusterAccentMap.teal;
  return clusterAccentMap.amber;
}

function SummaryCard({ entry, summaryRecord, dispatch, clusterAccent }) {
  const selectedOutcomeIds = summaryRecord?.outcomeIds || [];
  const selectedLabels = summaryRecord?.labels || [];
  const isIncludedInReport = Boolean(summaryRecord?.includeInReport);

  return (
    <article className={`panel pad summary-card${isIncludedInReport ? " report-included" : ""}`} style={{ "--cluster-accent": clusterAccent }}>
      <div className="section-head">
        <div>
          <div className="kicker">{formatDateLabel(getEntryDate(entry))}</div>
          <h2>{entry.dealership.name}</h2>
          <small>{entry.dealership.address || "Address not captured"}</small>
        </div>
        <span className={`pill${selectedOutcomeIds.length ? " active" : ""}`}>
          {selectedOutcomeIds.length ? "Reviewed" : "Needs review"}
        </span>
      </div>
      <div className="summary-report-line">
        <span className="summary-report-dot"></span>
        <span>{isIncludedInReport ? "Added to final report" : "Review this dealership, then add it to the report"}</span>
      </div>

      <div className="summary-context-grid">
        <div>
          <label>Lead inputs</label>
          <div className="summary-chip-row">
            {(entry.latestVisit?.outcomes?.length ? entry.latestVisit.outcomes : ["No visit chips recorded"]).map((outcome) => (
              <span className="summary-read-chip" key={outcome}>
                {outcome}
              </span>
            ))}
          </div>
        </div>
        <div>
          <label>Dashboard actions completed</label>
          <div className="summary-chip-row">
            {entry.completedActions.length ? (
              entry.completedActions.map((action) => (
                <span className="summary-read-chip" key={action.id}>
                  {formatCompletedAction(action)}
                </span>
              ))
            ) : (
              <span className="summary-read-chip">No dashboard action completed yet</span>
            )}
          </div>
        </div>
      </div>

      <div className="summary-review-block">
        <label>Friday review chips</label>
        <div className="summary-chip-row">
          {summaryOutcomeCatalog.map((option) => (
            <button
              className={`chip ${selectedOutcomeIds.includes(option.id) ? "selected" : ""}`}
              key={option.id}
              type="button"
              onClick={() =>
                dispatch({
                  type: "toggle-summary-outcome",
                  dealershipId: entry.dealership.id,
                  outcomeId: option.id,
                  label: option.label,
                  createChaseAction: option.createChaseAction,
                  chaseTitle: option.chaseTitle,
                  chaseNote: option.chaseNote,
                })
              }
            >
              {option.label}
            </button>
          ))}
        </div>
        <small>
          {selectedLabels.length
            ? `Saved summary: ${selectedLabels.join(", ")}.`
            : "Use these after the dashboard actions have actually happened."}
        </small>
      </div>

      <div className="summary-card-actions">
        {isIncludedInReport ? (
          <>
            <span className="pill active">Report ready</span>
            <button
              className="btn ghost"
              type="button"
              onClick={() =>
                dispatch({
                  type: "set-summary-report-inclusion",
                  dealershipId: entry.dealership.id,
                  includeInReport: false,
                })
              }
            >
              Remove
            </button>
          </>
        ) : (
          <button
            className="btn primary"
            type="button"
            onClick={() =>
              dispatch({
                type: "set-summary-report-inclusion",
                dealershipId: entry.dealership.id,
                includeInReport: true,
              })
            }
          >
            Add to report
          </button>
        )}
      </div>
    </article>
  );
}

export function SummaryPage() {
  const { state, completedActions, getDealershipById, dispatch } = useAppState();
  const [exportState, setExportState] = useState("idle");
  const [exportMessage, setExportMessage] = useState("");
  const reportClusters = useMemo(() => getReportClusters(state), [state]);
  const [selectedReportClusterId, setSelectedReportClusterId] = useState("");

  const summaryEntries = useMemo(() => {
    const entryMap = new Map();

    state.visits.forEach((visit) => {
      const dealership = getDealershipById(visit.dealershipId);
      if (!dealership?.id) return;
      const existing = entryMap.get(dealership.id) || {
        dealership,
        visits: [],
        completedActions: [],
      };
      existing.visits.push(visit);
      entryMap.set(dealership.id, existing);
    });

    completedActions.forEach((action) => {
      const dealership = getDealershipById(action.dealershipId);
      if (!dealership?.id) return;
      const existing = entryMap.get(dealership.id) || {
        dealership,
        visits: [],
        completedActions: [],
      };
      existing.completedActions.push(action);
      entryMap.set(dealership.id, existing);
    });

    return [...entryMap.values()]
      .map((entry) => ({
        ...entry,
        latestVisit: [...entry.visits].sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))[0],
        completedActions: [...entry.completedActions].sort((left, right) =>
          String(right.completedAt || "").localeCompare(String(left.completedAt || "")),
        ),
      }))
      .sort((left, right) => String(getEntryDate(right)).localeCompare(String(getEntryDate(left))));
  }, [completedActions, getDealershipById, state.visits]);

  const summaryByDealership = new Map((state.summaryOutcomes || []).map((item) => [item.dealershipId, item]));
  const reviewedCount = summaryEntries.filter((entry) => summaryByDealership.get(entry.dealership.id)?.outcomeIds?.length).length;
  const reportIncludedCount = summaryEntries.filter((entry) => summaryByDealership.get(entry.dealership.id)?.includeInReport).length;
  const clusterSummaries = reportClusters
    .map((cluster) => {
      const entries = summaryEntries.filter((entry) => entry.dealership.clusterId === cluster.id);
      const reviewed = entries.filter((entry) => summaryByDealership.get(entry.dealership.id)?.outcomeIds?.length).length;
      const included = entries.filter((entry) => summaryByDealership.get(entry.dealership.id)?.includeInReport).length;
      return {
        cluster,
        entries,
        reviewed,
        included,
        accent: getClusterAccent(cluster),
      };
    })
    .filter((item) => item.entries.length);
  const selectedReportCluster =
    clusterSummaries.find((item) => item.cluster.id === selectedReportClusterId)?.cluster ||
    clusterSummaries.find((item) => item.included > 0)?.cluster ||
    clusterSummaries[0]?.cluster ||
    reportClusters[0];
  const selectedReportSummary = clusterSummaries.find((item) => item.cluster.id === selectedReportCluster?.id);

  async function downloadClusterReport(cluster) {
    if (!cluster?.id) {
      setExportState("error");
      setExportMessage("No report cluster is available yet.");
      return;
    }

    setExportState("exporting");
    setExportMessage("");

    try {
      const response = await fetch(buildReportPdfUrl(cluster.id));
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "PDF export failed.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${String(cluster.name || "cluster").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-field-report.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setExportState("done");
      setExportMessage(`${cluster.name} report downloaded.`);
    } catch (error) {
      setExportState("error");
      setExportMessage(error.message || "PDF export could not be generated.");
    }
  }

  return (
    <AppLayout statusLine="Weekly response review">
      <section className="title-row">
        <div>
          <div className="kicker">Summary</div>
          <h1>Close the loop after the visit and dashboard actions have happened.</h1>
        </div>
        <span className="pill active">
          {reviewedCount}/{summaryEntries.length} reviewed
        </span>
      </section>

      <section className="pipeline-strip panel pad" aria-label="Summary workflow">
        <div>
          <span className="flow-dot active"></span>
          <b>Leads</b>
          <small>First visit chips</small>
        </div>
        <div>
          <span className="flow-dot"></span>
          <b>Dashboard</b>
          <small>Admin actions completed</small>
        </div>
        <div>
          <span className="flow-dot"></span>
          <b>Summary</b>
          <small>Response status and next chase</small>
        </div>
        <div>
          <span className="flow-dot"></span>
          <b>PDF handoff</b>
          <small>Generate after final review</small>
        </div>
      </section>

      <section className="grid three">
        <div className="panel metric">
          <strong>{summaryEntries.length}</strong>
          <span>dealerships with visit or dashboard history</span>
        </div>
        <div className="panel metric">
          <strong>{completedActions.length}</strong>
          <span>completed dashboard actions available for review</span>
        </div>
        <div className="panel metric">
          <strong>{reviewedCount}</strong>
          <span>dealerships reviewed for weekly response status</span>
        </div>
        <div className="panel metric">
          <strong>{reportIncludedCount}</strong>
          <span>dealerships added to the final report</span>
        </div>
      </section>

      {exportMessage ? <div className={`inline-alert${exportState === "error" ? " error" : ""}`}>{exportMessage}</div> : null}

      <section className="summary-cluster-list">
        {clusterSummaries.map(({ cluster, entries: clusterEntries, reviewed: reviewedClusterCount, included: includedClusterCount, accent: clusterAccent }) => {
          return (
            <section className="summary-cluster panel pad" key={cluster.id} style={{ "--cluster-accent": clusterAccent }}>
              <div className="section-head summary-cluster-head">
                <div>
                  <div className="kicker">Cluster</div>
                  <h2>{cluster.name}</h2>
                  <small>
                    {includedClusterCount}/{clusterEntries.length} added to report, {reviewedClusterCount} reviewed
                  </small>
                </div>
                <span className="pill">{includedClusterCount} added</span>
              </div>
              <div className="summary-card-list">
                {clusterEntries.map((entry) => (
                  <SummaryCard
                    clusterAccent={clusterAccent}
                    dispatch={dispatch}
                    entry={entry}
                    key={entry.dealership.id}
                    summaryRecord={summaryByDealership.get(entry.dealership.id)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </section>

      <section className="panel pad summary-final-panel">
        <div className="section-head">
          <div>
            <div className="kicker">Final handoff</div>
            <h2>Generate the weekly report when the reviewed dealerships are added.</h2>
            <small>
              {selectedReportSummary
                ? `${selectedReportSummary.included}/${selectedReportSummary.entries.length} ${selectedReportSummary.cluster.name} dealerships added.`
                : "Add at least one dealership to prepare a report."}
            </small>
          </div>
          <span className="pill active">{reportIncludedCount} total added</span>
        </div>
        <div className="summary-final-controls">
          <label>
            Report cluster
            <select
              className="text-input"
              value={selectedReportCluster?.id || ""}
              onChange={(event) => setSelectedReportClusterId(event.target.value)}
            >
              {clusterSummaries.map(({ cluster, included, entries }) => (
                <option key={cluster.id} value={cluster.id}>
                  {cluster.name} - {included}/{entries.length} added
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn primary"
            type="button"
            disabled={exportState === "exporting" || !selectedReportCluster?.id || !selectedReportSummary?.included}
            onClick={() => downloadClusterReport(selectedReportCluster)}
          >
            {exportState === "exporting" ? "Generating report..." : "Generate and download Report"}
          </button>
        </div>
      </section>
    </AppLayout>
  );
}
