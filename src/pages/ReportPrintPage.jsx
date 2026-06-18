import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ClusterReportTemplate } from "../components/ClusterReportTemplate";
import { buildClusterReportModel } from "../lib/reporting";
import { useAppState } from "../state/AppState";

export function ReportPrintPage() {
  const [searchParams] = useSearchParams();
  const { clusters, selectedCluster, state, getDealershipsForCluster, getDraftForDealership, getLatestContact, getLatestMedia } = useAppState();
  const clusterId = searchParams.get("cluster") || selectedCluster.id;
  const autoprint = searchParams.get("autoprint") === "1";
  const cluster = clusters.find((item) => item.id === clusterId) || selectedCluster;

  const reportModel = useMemo(
    () =>
      buildClusterReportModel({
        state,
        cluster,
        dealerships: getDealershipsForCluster(cluster.id),
        getDraftForDealership,
        getLatestContact,
        getLatestMedia,
      }),
    [cluster, getDealershipsForCluster, getDraftForDealership, getLatestContact, getLatestMedia, state],
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
