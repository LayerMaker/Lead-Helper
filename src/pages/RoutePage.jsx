import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  buildDraftBody,
  buildAdminEntries,
  buildGoogleMapsRouteUrl,
  defaultVisitOutcomes,
  fromDateTimeLocalValue,
  getOptimizedDealershipsForCluster,
  toDateTimeLocalValue,
} from "../lib/leadHelperModel";
import { AppLayout } from "../components/AppLayout";
import { useAppState } from "../state/AppState";

const routeOutcomes = ["Met manager", "Interested", "Needs email", "Follow-up required", "Site walk booked", "Deferred to decision maker", "Card captured", "Not suitable"];

function RouteComposer({ state, dealerships, selectedDealership, currentVisit, dispatch }) {
  const [selectedOutcomes, setSelectedOutcomes] = useState(currentVisit?.outcomes || defaultVisitOutcomes);
  const [quickNote, setQuickNote] = useState(currentVisit?.note || "");
  const [scheduleValue, setScheduleValue] = useState("");
  const adminEntries = useMemo(() => buildAdminEntries(selectedOutcomes), [selectedOutcomes]);
  const generatedDraft = useMemo(
    () => buildDraftBody(state, selectedDealership.id, selectedOutcomes),
    [selectedDealership.id, selectedOutcomes, state],
  );

  function toggleOutcome(outcome) {
    setSelectedOutcomes((current) =>
      current.includes(outcome) ? current.filter((item) => item !== outcome) : [...current, outcome],
    );
  }

  async function copyDraft() {
    try {
      await window.navigator.clipboard.writeText(generatedDraft);
    } catch {
      // Quiet fallback for environments without clipboard support.
    }
  }

  return (
    <section className="grid two">
      <div className="panel table">
        {dealerships.map((dealership, index) => {
          const isCurrent = dealership.id === selectedDealership.id;

          return (
            <div key={dealership.id}>
              <div className={`row${isCurrent ? " selected" : ""}`}>
                <span className="number">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{dealership.name}</h3>
                  <small>
                    {dealership.address} - {dealership.roleHint}
                  </small>
                </div>
                <button className={`btn${isCurrent ? " primary" : ""}`} type="button" onClick={() => dispatch({ type: "select-dealership", dealershipId: dealership.id })}>
                  Log visit
                </button>
              </div>
              {isCurrent ? (
                <div className="visit-panel open">
                  <h3>Visit outcome</h3>
                  <div className="outcomes">
                    {routeOutcomes.map((outcome) => (
                      <button
                        key={outcome}
                        className={`chip${selectedOutcomes.includes(outcome) ? " selected" : ""}`}
                        type="button"
                        onClick={() => toggleOutcome(outcome)}
                      >
                        {outcome}
                      </button>
                    ))}
                  </div>
                  <p>
                    {dealership.phone} - {dealership.website}. Lead score {dealership.leadScore}. Next action: {dealership.nextAction}.
                  </p>
                  <div className="field" style={{ marginTop: 12 }}>
                    <label>Quick note</label>
                    <textarea
                      className="input"
                      rows="3"
                      value={quickNote}
                      onChange={(event) => setQuickNote(event.target.value)}
                      placeholder="Optional note for the report card or follow-up."
                    />
                  </div>
                  <div className="field" style={{ marginTop: 12 }}>
                    <label>Next action due</label>
                    <input
                      className="text-input"
                      type="datetime-local"
                      value={scheduleValue}
                      onChange={(event) => setScheduleValue(event.target.value)}
                    />
                  </div>
                  <div className="action-row">
                    <button
                      className="btn"
                      type="button"
                      onClick={() => {
                        const next = new Date();
                        next.setHours(16, 30, 0, 0);
                        setScheduleValue(toDateTimeLocalValue(next.toISOString()));
                      }}
                    >
                      Today 16:30
                    </button>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => {
                        const next = new Date();
                        next.setDate(next.getDate() + 1);
                        next.setHours(10, 30, 0, 0);
                        setScheduleValue(toDateTimeLocalValue(next.toISOString()));
                      }}
                    >
                      Tomorrow 10:30
                    </button>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => {
                        const next = new Date();
                        next.setDate(next.getDate() + 2);
                        next.setHours(11, 0, 0, 0);
                        setScheduleValue(toDateTimeLocalValue(next.toISOString()));
                      }}
                    >
                      +2 days
                    </button>
                  </div>
                  <div className="action-row" style={{ marginTop: 12 }}>
                    <button
                      className="btn primary"
                      type="button"
                      disabled={selectedOutcomes.length === 0}
                      onClick={() =>
                        dispatch({
                          type: "generate-visit",
                          dealershipId: dealership.id,
                          outcomes: selectedOutcomes,
                          note: quickNote || "Generated from route logging",
                          scheduleAt: fromDateTimeLocalValue(scheduleValue),
                        })
                      }
                    >
                      Generate admin
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <aside className="panel pad">
        <div className="kicker">Generated admin</div>
        <h2>{selectedDealership.name} ready-to-send admin</h2>
        <p className="draft">{generatedDraft}</p>
        <div className="admin-actions">
          {adminEntries.map((entry, index) => (
            <div className={`row${index === 0 ? " selected" : ""}`} key={entry.label}>
              <span className="number">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3>{entry.label}</h3>
                <small>{entry.detail}</small>
              </div>
              <span className={`pill${index === 0 ? " active" : ""}`}>{entry.type}</span>
            </div>
          ))}
        </div>
        <div className="grid two" style={{ marginTop: 12 }}>
          <Link className="btn" to="/email">
            Open draft
          </Link>
          <button className="btn primary" type="button" onClick={copyDraft}>
            Copy note
          </button>
        </div>
      </aside>
    </section>
  );
}

export function RoutePage() {
  const { state, selectedCluster, selectedDealership, getLatestVisit, dispatch } = useAppState();
  const dealerships = useMemo(() => getOptimizedDealershipsForCluster(state, selectedCluster.id), [selectedCluster.id, state]);
  const visitCount = state.visits.filter((visit) => visit.clusterId === selectedCluster.id).length;
  const currentVisit = getLatestVisit(selectedDealership.id);
  const mapsRouteUrl = buildGoogleMapsRouteUrl(state, selectedCluster.id);

  return (
    <AppLayout statusLine={`${selectedCluster.name} Route - ${visitCount} of ${dealerships.length} visited`}>
      <section className="title-row">
        <div>
          <div className="kicker">Cluster route</div>
          <h1>{selectedCluster.name} Route keeps the next stop and admin in one thumb zone.</h1>
          <p className="subtle-copy">Route order is now optimized from the cluster geography so the next stop is based on the shortest next hop, not a fixed seed list.</p>
        </div>
        <a className="btn primary" href={mapsRouteUrl} target="_blank" rel="noreferrer">
          Open in maps
        </a>
      </section>

      <RouteComposer
        key={`${selectedDealership.id}-${currentVisit?.createdAt || "new"}`}
        state={state}
        dealerships={dealerships}
        selectedDealership={selectedDealership}
        currentVisit={currentVisit}
        dispatch={dispatch}
      />
    </AppLayout>
  );
}
