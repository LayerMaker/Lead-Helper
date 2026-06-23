import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "../components/AppLayout";
import { fromDateTimeLocalValue, getPendingActionBuckets, toDateTimeLocalValue } from "../lib/leadHelperModel";
import { useAppState } from "../state/AppState";

function getCompletionOptions(action) {
  const title = String(action.title || "").toLowerCase();

  if (isSoftWaitingAction(action)) {
    return [
      { label: "Responded", outcome: "responded" },
      { label: "Close for now", outcome: "closed_for_now" },
    ];
  }

  if (action.type === "email") {
    const sentLabel = title.includes("pack") || title.includes("details") || title.includes("summary") ? "Site pack sent" : "Email sent";
    return [
      { label: sentLabel, outcome: "follow_up_sent" },
      { label: "No reply yet", outcome: "no_reply_yet" },
      { label: "Responded", outcome: "responded" },
      { label: "Closed for now", outcome: "closed_for_now" },
    ];
  }

  if (action.type === "call") {
    return [
      { label: "Spoke to contact", outcome: "call_completed" },
      { label: "No answer", outcome: "no_answer" },
      { label: "Call back needed", outcome: "call_back_needed" },
    ];
  }

  if (action.type === "site_walk") {
    return [
      { label: "Confirmed", outcome: "site_walk_confirmed" },
      { label: "Reschedule needed", outcome: "site_walk_reschedule" },
      { label: "Completed", outcome: "site_walk_completed" },
    ];
  }

  return [
    { label: "Done", outcome: "done" },
    { label: "Follow-up needed", outcome: "follow_up_needed" },
  ];
}

function isSoftWaitingAction(action) {
  const haystack = [action.title, action.note, action.type, action.sourceSummaryOutcome].filter(Boolean).join(" ").toLowerCase();
  const softSummaryOutcomes = new Set(["no_response_yet", "chase_next_week"]);
  if (softSummaryOutcomes.has(action.sourceSummaryOutcome)) return true;

  return [
    "no response",
    "awaiting",
    "waiting",
    "sharing with team",
    "team feedback",
    "team approval",
    "senior team",
    "site pack response",
    "weekly follow-up",
    "chase site pack response",
  ].some((phrase) => haystack.includes(phrase));
}

function buildHoldDueAt() {
  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + 7);
  dueAt.setHours(10, 30, 0, 0);
  return dueAt.toISOString();
}

function ScheduledActionRow({ action, getDealershipById, dispatch, tone = "active" }) {
  const [scheduleValue, setScheduleValue] = useState(toDateTimeLocalValue(action.dueAt));
  const dealership = getDealershipById(action.dealershipId);
  const completionOptions = getCompletionOptions(action);
  const isWaiting = tone === "waiting";

  function openDestination() {
    dispatch({ type: "select-dealership", dealershipId: action.dealershipId });
  }

  return (
    <div className={`row dashboard-action-row${isWaiting ? " waiting-action-row" : ""}`}>
      <span className="number">{isWaiting ? "WAIT" : action.priority === "high" ? "HI" : "UP"}</span>
      <div>
        <h3>
          {dealership?.name || action.dealershipId}: {action.title}
        </h3>
        <small>
          {isWaiting ? "Waiting on their side. Keep visible without treating it as urgent." : action.note} Due {action.dueText}.
        </small>
        <div className="dashboard-action-tools">
          <input
            className="text-input compact-datetime"
            type="datetime-local"
            value={scheduleValue}
            onChange={(event) => setScheduleValue(event.target.value)}
          />
          <button
            className="btn"
            type="button"
            onClick={() =>
              dispatch({
                type: "reschedule-action",
                actionId: action.id,
                dueAt: fromDateTimeLocalValue(scheduleValue),
              })
            }
          >
            Save time
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => {
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);
              tomorrow.setHours(10, 30, 0, 0);
              setScheduleValue(toDateTimeLocalValue(tomorrow.toISOString()));
              dispatch({
                type: "reschedule-action",
                actionId: action.id,
                dueAt: tomorrow.toISOString(),
              });
            }}
          >
            Tomorrow 10:30
          </button>
        </div>
      </div>
      <div className="dashboard-action-cta">
        {isWaiting ? (
          <Link className="btn" to="/leads" onClick={openDestination}>
            Review lead
          </Link>
        ) : action.type === "email" ? (
          <Link className="btn primary" to="/email" onClick={openDestination}>
            Open FGI
          </Link>
        ) : (
          <Link className="btn" to="/leads" onClick={openDestination}>
            {action.type === "call" ? "Call" : "Review"}
          </Link>
        )}
        <div className="dashboard-completion-options" aria-label="Complete action outcome">
          {completionOptions.map((option, index) => (
            <button
              className={`btn${index === 0 ? " primary" : ""}`}
              key={option.outcome}
              type="button"
              onClick={() =>
                dispatch({
                  type: "complete-action",
                  actionId: action.id,
                  outcome: option.outcome,
                  label: option.label,
                })
              }
            >
              {option.label}
            </button>
          ))}
          {isWaiting ? (
            <button
              className="btn"
              type="button"
              onClick={() => {
                const holdDueAt = buildHoldDueAt();
                setScheduleValue(toDateTimeLocalValue(holdDueAt));
                dispatch({
                  type: "reschedule-action",
                  actionId: action.id,
                  dueAt: holdDueAt,
                });
              }}
            >
              Hold 7 days
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ActionBucket({ title, description, actions, emptyText, getDealershipById, dispatch, tone = "active" }) {
  return (
    <section className={`panel pad dashboard-bucket${tone === "waiting" ? " waiting-bucket" : ""}`}>
      <div className="section-head">
        <div>
          <div className="kicker">{title}</div>
          <h2>{description}</h2>
        </div>
        <span className={`pill${actions.length ? " active" : ""}`}>{actions.length}</span>
      </div>

      <div className="admin-actions">
        {actions.length ? (
          actions.map((action) => (
            <ScheduledActionRow key={action.id} action={action} getDealershipById={getDealershipById} dispatch={dispatch} tone={tone} />
          ))
        ) : (
          <div className="row">
            <span className="number">--</span>
            <div>
              <h3>Clear</h3>
              <small>{emptyText}</small>
            </div>
            <span className="pill">Empty</span>
          </div>
        )}
      </div>
    </section>
  );
}

export function DashboardPage() {
  const {
    pendingActions,
    pendingDrafts,
    clustersWithVisits,
    selectedCluster,
    getDealershipsForCluster,
    getLatestVisit,
    getDealershipById,
    dispatch,
  } = useAppState();
  const clusterDealers = getDealershipsForCluster(selectedCluster.id);
  const activePendingActions = useMemo(() => pendingActions.filter((action) => !isSoftWaitingAction(action)), [pendingActions]);
  const waitingPendingActions = useMemo(() => pendingActions.filter((action) => isSoftWaitingAction(action)), [pendingActions]);
  const actionBuckets = useMemo(() => getPendingActionBuckets(activePendingActions), [activePendingActions]);
  const waitingBuckets = useMemo(() => getPendingActionBuckets(waitingPendingActions), [waitingPendingActions]);
  const waitingActions = [...waitingBuckets.overdue, ...waitingBuckets.today, ...waitingBuckets.upcoming];
  const leadAction = actionBuckets.overdue[0] || actionBuckets.today[0] || actionBuckets.upcoming[0] || null;
  const latestVisit = leadAction ? getLatestVisit(leadAction.dealershipId) : null;

  return (
    <AppLayout statusLine={`Today - ${selectedCluster.name} route and follow-up day`}>
      <section className="title-row">
        <div>
          <div className="kicker">Dashboard</div>
          <h1>Start with what is overdue, then clear today, then move into the field route.</h1>
        </div>
        <Link className="btn primary" to="/map">
          Choose cluster
        </Link>
      </section>

      <section className="pipeline-strip panel pad" aria-label="Visit data pipeline">
        <div>
          <span className="flow-dot active"></span>
          <b>Visit log</b>
          <small>Outcomes captured at the forecourt</small>
        </div>
        <div>
          <span className="flow-dot"></span>
          <b>Today engine</b>
          <small>Overdue, today, and upcoming reminders</small>
        </div>
        <div>
          <span className="flow-dot"></span>
          <b>FGI Email</b>
          <small>Suggested draft and admin tasks</small>
        </div>
        <div>
          <span className="flow-dot"></span>
          <b>Summary</b>
          <small>Weekly review and PDF handoff</small>
        </div>
      </section>

      <section className="grid three">
        <div className="panel metric">
          <strong>{actionBuckets.overdue.length + actionBuckets.today.length}</strong>
          <span>active obligations to clear before field work</span>
        </div>
        <div className="panel metric">
          <strong>{actionBuckets.upcoming.length}</strong>
          <span>scheduled actions that are still on your side</span>
        </div>
        <div className="panel metric">
          <strong>{waitingActions.length}</strong>
          <span>waiting on their side, visible but lower pressure</span>
        </div>
      </section>

      <section className="grid two" style={{ marginTop: 14 }}>
        <div className="grid dashboard-main-grid">
          <ActionBucket
            title="Overdue"
            description="Missed follow-ups and callbacks"
            actions={actionBuckets.overdue}
            emptyText="Nothing overdue right now."
            getDealershipById={getDealershipById}
            dispatch={dispatch}
          />
          <ActionBucket
            title="Due today"
            description="Clear these before moving on"
            actions={actionBuckets.today}
            emptyText="No same-day actions waiting."
            getDealershipById={getDealershipById}
            dispatch={dispatch}
          />
          <ActionBucket
            title="Upcoming"
            description="Scheduled next touches and meetings"
            actions={actionBuckets.upcoming}
            emptyText="Nothing queued yet."
            getDealershipById={getDealershipById}
            dispatch={dispatch}
          />
          <ActionBucket
            title="Waiting on them"
            description="Keep these visible without over-chasing the lead"
            actions={waitingActions}
            emptyText="No soft follow-ups waiting on the lead right now."
            getDealershipById={getDealershipById}
            dispatch={dispatch}
            tone="waiting"
          />
        </div>

        <aside className="panel pad">
          <div className="kicker">Live cluster feed</div>
          <div className="intel-card">
            <span className="radar-dot"></span>
            <div>
              <h3>{selectedCluster.name} cluster</h3>
              <small>
                {clusterDealers.length} scraped pins,{" "}
                {clusterDealers.filter((dealer) => dealer.status === "Interested" || dealer.status === "Site walk booked").length} warm
                leads, {activePendingActions.length} active actions, {waitingActions.length} waiting
              </small>
            </div>
            <span className="pill active">Active</span>
          </div>
          <div className="feed-forward">
            <span className="flow-dot"></span>
            <div>
              <b>Start-of-day focus</b>
              <small>
                {leadAction
                  ? `${getDealershipById(leadAction.dealershipId)?.name}: ${leadAction.title}. ${leadAction.dueText}.`
                  : "No urgent actions. Move straight into the next cluster route."}
              </small>
            </div>
          </div>
          <div className="feed-forward">
            <span className="flow-dot"></span>
            <div>
              <b>Latest captured input</b>
              <small>
                {latestVisit
                  ? `${getDealershipById(latestVisit.dealershipId)?.name}: ${latestVisit.outcomes.join(", ")}.`
                  : "No visit captured yet."}
              </small>
            </div>
          </div>
          <div className="feed-forward">
            <span className="flow-dot"></span>
            <div>
              <b>Generated downstream</b>
              <small>
                {pendingDrafts.length} draft ready, {activePendingActions.length} active actions, {waitingActions.length} waiting on them,
                and {clustersWithVisits.size} reportable clusters.
              </small>
            </div>
          </div>
          <div className="action-row">
            <Link className="btn" to="/leads">
              Open intel
            </Link>
            <Link className="btn" to="/summary">
              Weekly summary
            </Link>
          </div>
        </aside>
      </section>
    </AppLayout>
  );
}
