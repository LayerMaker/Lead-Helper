import { useMemo } from "react";
import { AppLayout } from "../components/AppLayout";
import { useAppState } from "../state/AppState";

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

function SummaryCard({ entry, summaryRecord, dispatch }) {
  const selectedOutcomeIds = summaryRecord?.outcomeIds || [];
  const selectedLabels = summaryRecord?.labels || [];

  return (
    <article className="panel pad summary-card">
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
    </article>
  );
}

export function SummaryPage() {
  const { state, clusters, completedActions, getDealershipById, dispatch } = useAppState();

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
          <b>Reports</b>
          <small>Weekly handoff later</small>
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
      </section>

      <section className="summary-cluster-list">
        {clusters.map((cluster) => {
          const clusterEntries = summaryEntries.filter((entry) => entry.dealership.clusterId === cluster.id);
          if (!clusterEntries.length) return null;

          return (
            <section className="summary-cluster" key={cluster.id}>
              <div className="section-head">
                <div>
                  <div className="kicker">Cluster</div>
                  <h2>{cluster.name}</h2>
                </div>
                <span className="pill">{clusterEntries.length}</span>
              </div>
              <div className="summary-card-list">
                {clusterEntries.map((entry) => (
                  <SummaryCard
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
    </AppLayout>
  );
}
