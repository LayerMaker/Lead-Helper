import { useMemo, useRef, useState } from "react";
import { ClusterReportTemplate } from "../components/ClusterReportTemplate";
import { canonicalDealershipId, getEmailIntentDetails } from "../lib/leadHelperModel";
import { AppLayout } from "../components/AppLayout";
import {
  buildClusterReportModel,
  buildDealershipsFromReportPins,
  buildEmailProofSummary,
  buildReportPrintUrl,
  getDefaultReportClusterId,
  getReportClusters,
  getReportPinsForCluster,
  isMapV2ReportCluster,
} from "../lib/reporting";
import { useAppState } from "../state/AppState";

export function ReportsPage() {
  const {
    dealerships,
    state,
    getDealershipsForCluster,
    getDealershipById,
    getDraftForDealership,
    getLatestContact,
    getLatestMedia,
  } = useAppState();
  const [exportState, setExportState] = useState("idle");
  const [exportMessage, setExportMessage] = useState("");
  const reportClusters = useMemo(() => getReportClusters(state), [state]);
  const [selectedReportClusterId, setSelectedReportClusterId] = useState(() => getDefaultReportClusterId(state));
  const reportRef = useRef(null);
  const defaultReportClusterId = useMemo(() => getDefaultReportClusterId(state), [state]);
  const selectedReportCluster =
    reportClusters.find((cluster) => cluster.id === selectedReportClusterId) ||
    reportClusters.find((cluster) => cluster.id === defaultReportClusterId) ||
    reportClusters[0];

  const selectedReportPins = useMemo(
    () => getReportPinsForCluster(state, selectedReportCluster?.id),
    [selectedReportCluster?.id, state],
  );
  const selectedReportDealerships = useMemo(
    () =>
      selectedReportPins.length
        ? buildDealershipsFromReportPins({
            pins: selectedReportPins,
            clusterId: selectedReportCluster?.id,
            allDealerships: dealerships,
            getDealershipById,
          })
        : isMapV2ReportCluster(state, selectedReportCluster?.id)
          ? []
          : getDealershipsForCluster(selectedReportCluster?.id),
    [dealerships, getDealershipById, getDealershipsForCluster, selectedReportCluster?.id, selectedReportPins, state],
  );

  const reportModel = useMemo(
    () =>
      buildClusterReportModel({
        state,
        cluster: selectedReportCluster,
        dealerships: selectedReportDealerships,
        mapPins: selectedReportPins,
        getDraftForDealership,
        getLatestContact,
        getLatestMedia,
      }),
    [getDraftForDealership, getLatestContact, getLatestMedia, selectedReportCluster, selectedReportDealerships, selectedReportPins, state],
  );

  function handleExportVisibleCluster() {
    const printUrl = `${buildReportPrintUrl(reportModel.clusterId)}&autoprint=1`;
    window.open(printUrl, "_blank", "noopener,noreferrer");
    setExportState("done");
    setExportMessage("Print/PDF view opened using the local browser data.");
  }

  function scrollToPreview() {
    reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const printViewUrl = buildReportPrintUrl(reportModel.clusterId);

  return (
    <AppLayout statusLine="Cluster proof of work">
      <section className="title-row">
        <div>
          <div className="kicker">Reports</div>
          <h1>Generated proof cards grouped by the cluster you visited.</h1>
        </div>
        <div className="action-row">
          <button className="btn" type="button" onClick={scrollToPreview}>
            Preview export
          </button>
          <a className="btn" href={printViewUrl} target="_blank" rel="noreferrer">
            Open print view
          </a>
          <button className="btn primary" type="button" disabled={exportState === "exporting"} onClick={handleExportVisibleCluster}>
            Open PDF view
          </button>
        </div>
      </section>

      {exportState === "error" && exportMessage ? <div className="inline-alert error">{exportMessage}</div> : null}
      {exportState === "done" && exportMessage ? <div className="inline-alert">{exportMessage}</div> : null}

      <section className="pipeline-strip panel pad">
        <div>
          <span className="flow-dot active"></span>
          <b>Visit inputs</b>
          <small>Outcomes, photos, contacts</small>
        </div>
        <div>
          <span className="flow-dot"></span>
          <b>Email actions</b>
          <small>Sent, pending, copied</small>
        </div>
        <div>
          <span className="flow-dot"></span>
          <b>Cluster report</b>
          <small>Proof feed for Battersea tenant search</small>
        </div>
      </section>

      <section className="report-accordion">
        {reportClusters.map((cluster, index) => {
          const clusterPins = getReportPinsForCluster(state, cluster.id);
          const dealers = clusterPins.length
            ? buildDealershipsFromReportPins({
                pins: clusterPins,
                clusterId: cluster.id,
                allDealerships: dealerships,
                getDealershipById,
              })
            : isMapV2ReportCluster(state, cluster.id)
              ? []
              : getDealershipsForCluster(cluster.id);
          const dealerIds = new Set(dealers.map((dealer) => canonicalDealershipId(dealer.id)));
          const visits = state.visits.filter(
            (visit) => visit.clusterId === cluster.id || dealerIds.has(canonicalDealershipId(visit.dealershipId)),
          );
          const latestVisits = dealers
            .map((dealer) => visits.find((visit) => canonicalDealershipId(visit.dealershipId) === canonicalDealershipId(dealer.id)))
            .filter(Boolean);
          const openActions = state.actions.filter(
            (action) =>
              action.status === "pending" &&
              dealers.some((dealer) => canonicalDealershipId(dealer.id) === canonicalDealershipId(action.dealershipId)),
          ).length;
          const isOpen = selectedReportCluster?.id === cluster.id;

          return (
            <article className={`panel report-cluster${isOpen ? " open" : ""}`} key={cluster.id}>
              <button className="cluster-head" type="button" onClick={() => setSelectedReportClusterId(cluster.id)}>
                <span>
                  <span className="kicker">Cluster {String(index + 1).padStart(2, "0")}</span>
                  <b>{cluster.name}</b>
                  <small>
                    {dealers.length} map pins, {latestVisits.length} visits, {openActions} open actions
                  </small>
                </span>
                <span className={`pill${isOpen ? " active" : ""}`}>{isOpen ? "Open" : "Closed"}</span>
              </button>
              {isOpen ? (
                <div className="cluster-feed">
                  {latestVisits.length ? (
                    latestVisits.map((visit, visitIndex) => {
                      const dealership = dealers.find(
                        (dealer) => canonicalDealershipId(dealer.id) === canonicalDealershipId(visit.dealershipId),
                      );
                      const draft = getDraftForDealership(visit.dealershipId);
                      const contact = getLatestContact(visit.dealershipId);
                      const emailIntentLabels = getEmailIntentDetails(draft?.emailIntents || []).map((intent) => intent.label);
                      const emailProofSummary = buildEmailProofSummary({
                        draft,
                        contact,
                        dealership,
                        emailIntentLabels,
                        outcomes: visit.outcomes,
                      });
                      return (
                        <div className={`report-card${visitIndex === 0 ? " selected" : ""}`} key={visit.id}>
                          <div className="section-head">
                            <div>
                              <h3>{dealership.name}</h3>
                              <small>
                                {visit.outcomes.join(", ")}. {visit.note || dealership.nextAction}
                              </small>
                            </div>
                            <span className={`pill${dealership.status === "Interested" ? " active" : ""}`}>{dealership.status}</span>
                          </div>
                          <p>
                            {draft ? `${emailProofSummary.headline}. ${emailProofSummary.detail} ` : ""}
                            Lead score {dealership.leadScore}. Next action: {dealership.nextAction}.
                          </p>
                          <div className="action-row">
                            <button className="btn" type="button" onClick={scrollToPreview}>
                              Preview
                            </button>
                            <a className="btn" href={printViewUrl} target="_blank" rel="noreferrer">
                              Print view
                            </a>
                            <button className="btn primary" type="button" onClick={handleExportVisibleCluster}>
                              Open PDF view
                            </button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="report-card selected">
                      <div className="section-head">
                        <div>
                          <h3>No visit data yet</h3>
                          <small>This cluster has scraped pins but no logged outcomes yet.</small>
                        </div>
                        <span className="pill">Empty</span>
                      </div>
                      <p>Once you log visit outcomes and send follow-ups, this cluster will produce proof cards here.</p>
                    </div>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
      </section>

      <section className="report-preview-section">
        <div className="section-head">
          <div>
            <div className="kicker">Export preview</div>
            <h2>{reportModel.exportTitle}</h2>
          </div>
          <span className="pill active">{reportModel.fileName}</span>
        </div>

        <div className="report-preview-viewport panel">
          <div className="report-preview-frame">
            <ClusterReportTemplate report={reportModel} exportRef={reportRef} />
          </div>
        </div>
      </section>
    </AppLayout>
  );
}
