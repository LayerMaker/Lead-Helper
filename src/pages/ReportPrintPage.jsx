import { useEffect, useMemo, useState } from "react";
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
  const [pdfState, setPdfState] = useState("idle");
  const [pdfMessage, setPdfMessage] = useState("");
  const [generatedPdf, setGeneratedPdf] = useState(null);
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

  function getAbsolutePdfUrl(pathname) {
    return new URL(pathname, window.location.origin).toString();
  }

  async function createReportPdfSession({ force = false } = {}) {
    if (!reportModel?.clusterId) {
      throw new Error("No report cluster is selected.");
    }

    if (!force && generatedPdf) {
      return generatedPdf;
    }

    setPdfState("working");
    setPdfMessage("Generating a real PDF file from the report preview...");

    const response = await fetch("/api/reports/pdf/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clusterId: reportModel.clusterId, state }),
    });

    if (!response.ok) {
      let errorMessage = "Report PDF generation failed.";
      try {
        const body = await response.json();
        errorMessage = body.error || body.hint || errorMessage;
      } catch {
        errorMessage = await response.text();
      }
      throw new Error(errorMessage);
    }

    const body = await response.json();
    const nextPdf = {
      downloadUrl: getAbsolutePdfUrl(body.downloadUrl),
      expiresInSeconds: body.expiresInSeconds,
      fileName: body.fileName || reportModel.fileName || "lead-helper-report.pdf",
      url: getAbsolutePdfUrl(body.url),
    };
    setGeneratedPdf(nextPdf);
    return nextPdf;
  }

  async function downloadReportPdf() {
    try {
      const pdf = await createReportPdfSession();
      setPdfState("done");
      setPdfMessage("PDF generated as a file. Opening the download now...");
      window.location.assign(pdf.downloadUrl);
    } catch (error) {
      setPdfState("error");
      setPdfMessage(`${error.message} Use Print / Save as PDF as the fallback.`);
    }
  }

  async function openReportPdf() {
    try {
      const pdf = await createReportPdfSession();
      setPdfState("done");
      setPdfMessage("PDF generated as a file. Opening the PDF now...");
      window.location.assign(pdf.url);
    } catch (error) {
      setPdfState("error");
      setPdfMessage(`${error.message} Use Print / Save as PDF as the fallback.`);
    }
  }

  async function shareReportPdf() {
    try {
      const pdf = await createReportPdfSession();
      const response = await fetch(pdf.url);
      if (!response.ok) throw new Error("The generated PDF file could not be loaded for sharing.");
      const blob = await response.blob();
      const file = new File([blob], pdf.fileName, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: reportModel.exportTitle,
          text: reportModel.exportTitle,
        });
        setPdfState("done");
        setPdfMessage("PDF share sheet opened.");
        return;
      }

      setPdfState("done");
      setPdfMessage("Sharing files is not supported in this browser, so the real PDF file is opening instead.");
      window.location.assign(pdf.url);
    } catch (error) {
      setPdfState("error");
      setPdfMessage(`${error.message} Use Open PDF or Print / Save as PDF instead.`);
    }
  }

  return (
    <main className="report-print-page">
      <section className="report-print-toolbar no-print">
        <div>
          <div className="kicker">Report PDF preview</div>
          <h1>{reportModel.exportTitle}</h1>
          <small>Review the report below, then download, open, share, or print the same layout.</small>
        </div>
        <div className="action-row">
          <Link className="btn" to="/reports">
            Back to reports
          </Link>
          <button className="btn primary" type="button" disabled={pdfState === "working"} onClick={downloadReportPdf}>
            {pdfState === "working" ? "Generating..." : "Download PDF"}
          </button>
          <button className="btn" type="button" disabled={pdfState === "working"} onClick={openReportPdf}>
            Open PDF
          </button>
          <button className="btn" type="button" disabled={pdfState === "working"} onClick={shareReportPdf}>
            Share PDF
          </button>
          <button className="btn primary" type="button" onClick={() => window.print()}>
            Print / Save
          </button>
        </div>
      </section>
      {pdfMessage ? <div className={`report-print-status no-print${pdfState === "error" ? " error" : ""}`}>{pdfMessage}</div> : null}

      <div className="report-print-sheet-wrap">
        <ClusterReportTemplate report={reportModel} mode="print" />
      </div>
    </main>
  );
}
