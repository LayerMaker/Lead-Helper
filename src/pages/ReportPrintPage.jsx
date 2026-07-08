import { useEffect, useMemo, useRef, useState } from "react";
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
  const pendingPdfUrlRef = useRef("");
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
      if (pendingPdfUrlRef.current) window.URL.revokeObjectURL(pendingPdfUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (!autoprint) return;
    const timer = window.setTimeout(() => {
      window.print();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [autoprint]);

  async function createReportPdf() {
    if (!reportModel?.clusterId) {
      throw new Error("No report cluster is selected.");
    }

    setPdfState("working");
    setPdfMessage("Generating the PDF from the report preview...");

    const response = await fetch("/api/reports/pdf", {
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

    const blob = await response.blob();
    const fileName = response.headers.get("X-Report-Filename") || reportModel.fileName || "lead-helper-report.pdf";
    return { blob, fileName };
  }

  function keepPdfUrl(blob) {
    if (pendingPdfUrlRef.current) window.URL.revokeObjectURL(pendingPdfUrlRef.current);
    pendingPdfUrlRef.current = window.URL.createObjectURL(blob);
    return pendingPdfUrlRef.current;
  }

  async function downloadReportPdf() {
    try {
      const { blob, fileName } = await createReportPdf();
      const pdfUrl = keepPdfUrl(blob);
      const anchor = document.createElement("a");
      anchor.href = pdfUrl;
      anchor.download = fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setPdfState("done");
      setPdfMessage("PDF generated. If your phone does not show a download, use Open PDF or Share PDF from this screen.");
    } catch (error) {
      setPdfState("error");
      setPdfMessage(`${error.message} Use Print / Save as PDF as the fallback.`);
    }
  }

  async function openReportPdf() {
    const openedWindow = window.open("", "_blank");
    try {
      const { blob } = await createReportPdf();
      const pdfUrl = keepPdfUrl(blob);
      if (openedWindow) {
        openedWindow.location.href = pdfUrl;
      } else {
        window.location.href = pdfUrl;
      }
      setPdfState("done");
      setPdfMessage("PDF opened. Use the browser share/save controls if the file preview is shown.");
    } catch (error) {
      if (openedWindow) openedWindow.close();
      setPdfState("error");
      setPdfMessage(`${error.message} Use Print / Save as PDF as the fallback.`);
    }
  }

  async function shareReportPdf() {
    try {
      const { blob, fileName } = await createReportPdf();
      const file = new File([blob], fileName, { type: "application/pdf" });
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

      const pdfUrl = keepPdfUrl(blob);
      window.open(pdfUrl, "_blank", "noopener,noreferrer");
      setPdfState("done");
      setPdfMessage("Sharing is not supported in this browser, so the PDF was opened instead.");
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
