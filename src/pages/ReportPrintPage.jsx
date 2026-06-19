import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ClusterReportTemplate } from "../components/ClusterReportTemplate";
import {
  buildClusterReportModel,
  buildDealershipsFromReportPins,
  getDefaultReportClusterId,
  getReportClusters,
  getReportPinsForCluster,
  isMapV2ReportCluster,
} from "../lib/reporting";
import { useAppState } from "../state/AppState";

export function ReportPrintPage() {
  const [searchParams] = useSearchParams();
  const {
    dealerships,
    state,
    getDealershipsForCluster,
    getDealershipById,
    getDraftForDealership,
    getLatestContact,
    getLatestMedia,
  } = useAppState();
  const clusters = useMemo(() => getReportClusters(state), [state]);
  const clusterId = searchParams.get("cluster") || getDefaultReportClusterId(state);
  const autoprint = searchParams.get("autoprint") === "1";
  const cluster = clusters.find((item) => item.id === clusterId) || clusters[0];
  const reportPins = useMemo(() => getReportPinsForCluster(state, cluster?.id), [cluster?.id, state]);
  const reportDealerships = useMemo(
    () =>
      reportPins.length
        ? buildDealershipsFromReportPins({
            pins: reportPins,
            clusterId: cluster?.id,
            allDealerships: dealerships,
            getDealershipById,
          })
        : isMapV2ReportCluster(state, cluster?.id)
          ? []
          : getDealershipsForCluster(cluster?.id),
    [cluster?.id, dealerships, getDealershipById, getDealershipsForCluster, reportPins, state],
  );

  const reportModel = useMemo(
    () =>
      buildClusterReportModel({
        state,
        cluster,
        dealerships: reportDealerships,
        mapPins: reportPins,
        getDraftForDealership,
        getLatestContact,
        getLatestMedia,
      }),
    [cluster, getDraftForDealership, getLatestContact, getLatestMedia, reportDealerships, reportPins, state],
  );

  useEffect(() => {
    document.body.classList.add("print-route-body");
    return () => {
      document.body.classList.remove("print-route-body");
    };
  }, []);

  useEffect(() => {
    if (!autoprint) return;
    const timer = window.setTimeout(() => {
      window.print();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [autoprint]);

  return (
    <main className="report-print-page">
      <section className="report-print-toolbar no-print">
        <div>
          <div className="kicker">Print view</div>
          <h1>{reportModel.exportTitle}</h1>
        </div>
        <div className="action-row">
          <Link className="btn" to="/reports">
            Back to reports
          </Link>
          <button className="btn primary" type="button" onClick={() => window.print()}>
            Save as PDF
          </button>
        </div>
      </section>

      <div className="report-print-sheet-wrap">
        <ClusterReportTemplate report={reportModel} mode="print" />
      </div>
    </main>
  );
}
