import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "../components/AppLayout";
import { getDistanceMilesBetweenPoints } from "../lib/leadHelperModel";
import { runOpenRouterBusinessCardOcr } from "../lib/ocrService";
import { useAppState } from "../state/AppState";

function defaultFields(selectedDealership, latestContact) {
  return {
    name: latestContact?.name || "",
    role: latestContact?.role || "",
    email: latestContact?.email || "",
    phone: latestContact?.phone || "",
    company: latestContact?.name ? selectedDealership.name : selectedDealership.name || "",
    rawText: "",
  };
}

function formatMiles(value) {
  if (!Number.isFinite(value)) return "";
  return `${value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")} mi`;
}

export function LeadsPage() {
  const navigate = useNavigate();
  const {
    clusters,
    dealerships,
    selectedCluster,
    selectedDealership,
    getDealershipsForCluster,
    getLatestContact,
    dispatch,
  } = useAppState();
  const latestContact = getLatestContact(selectedDealership.id);
  const [capturedFileName, setCapturedFileName] = useState("");
  const [capturedImageUrl, setCapturedImageUrl] = useState("");
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrStatus, setOcrStatus] = useState("No contact media captured yet");
  const [ocrError, setOcrError] = useState("");
  const [ocrFields, setOcrFields] = useState(() => defaultFields(selectedDealership, latestContact));
  const previousDealershipIdRef = useRef(selectedDealership.id);
  const cameraVideoRef = useRef(null);
  const cameraCanvasRef = useRef(null);
  const [selectedGroupId, setSelectedGroupId] = useState(selectedCluster.id);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationStatus, setLocationStatus] = useState("Use location to suggest the nearest dealership.");
  const [locationSuggestion, setLocationSuggestion] = useState(null);
  const [dismissedSuggestionId, setDismissedSuggestionId] = useState("");
  const [guidedCameraOpen, setGuidedCameraOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);
  const [cameraError, setCameraError] = useState("");
  const [ocrCompleted, setOcrCompleted] = useState(false);

  const suggestedDomain = useMemo(() => selectedDealership.website || "", [selectedDealership.website]);
  const unclusteredDealerships = useMemo(
    () => dealerships.filter((dealership) => !dealership.clusterId),
    [dealerships],
  );
  const selectedGroupDealerships = useMemo(() => {
    if (selectedGroupId === "__unclustered") return unclusteredDealerships;
    return getDealershipsForCluster(selectedGroupId);
  }, [getDealershipsForCluster, selectedGroupId, unclusteredDealerships]);
  const selectedDealershipInGroup = selectedGroupDealerships.some((dealership) => dealership.id === selectedDealership.id);
  const nearestSuggestion = locationSuggestion && locationSuggestion.id !== dismissedSuggestionId ? locationSuggestion : null;

  useEffect(() => {
    if (previousDealershipIdRef.current === selectedDealership.id) return;
    previousDealershipIdRef.current = selectedDealership.id;
    setSelectedGroupId(selectedDealership.clusterId || "__unclustered");
    setOcrFields(defaultFields(selectedDealership, latestContact));
    setCapturedFileName("");
    setCapturedImageUrl("");
    setOcrError("");
    setOcrCompleted(false);
    setOcrStatus("No contact media captured yet");
  }, [latestContact, selectedDealership]);

  useEffect(() => {
    if (!guidedCameraOpen || !cameraStream || !cameraVideoRef.current) return;
    cameraVideoRef.current.srcObject = cameraStream;
    cameraVideoRef.current.play().catch(() => {});
  }, [cameraStream, guidedCameraOpen]);

  useEffect(() => () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
    }
  }, [cameraStream]);

  function updateField(key, value) {
    setOcrFields((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function handleGroupChange(groupId) {
    setSelectedGroupId(groupId);
    setDismissedSuggestionId("");

    if (groupId === "__unclustered") {
      if (unclusteredDealerships[0]) {
        dispatch({ type: "select-dealership", dealershipId: unclusteredDealerships[0].id });
      }
      return;
    }

    const nextDealers = getDealershipsForCluster(groupId);
    if (nextDealers[0]) {
      dispatch({ type: "select-dealership", dealershipId: nextDealers[0].id });
    } else {
      dispatch({ type: "select-cluster", clusterId: groupId });
    }
  }

  function handleDealershipChange(dealershipId) {
    if (!dealershipId) return;
    setDismissedSuggestionId("");
    dispatch({ type: "select-dealership", dealershipId });
  }

  function suggestNearestDealership() {
    if (!("geolocation" in navigator)) {
      setLocationStatus("Geolocation is not available on this device.");
      return;
    }

    setLocationBusy(true);
    setLocationStatus("Checking nearby dealership pins");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const userLocation = [position.coords.latitude, position.coords.longitude];
        const nearest =
          dealerships
            .filter((dealership) => Array.isArray(dealership.location))
            .map((dealership) => ({
              ...dealership,
              distanceMiles: getDistanceMilesBetweenPoints(userLocation, dealership.location),
            }))
            .sort((left, right) => left.distanceMiles - right.distanceMiles)[0] || null;

        setLocationBusy(false);
        setLocationSuggestion(nearest);
        setDismissedSuggestionId("");
        setLocationStatus(
          nearest
            ? `Nearest suggestion: ${nearest.name}, ${formatMiles(nearest.distanceMiles)} away.`
            : "No dealership pins with coordinates are available yet.",
        );
      },
      (error) => {
        setLocationBusy(false);
        if (error.code === error.PERMISSION_DENIED) {
          setLocationStatus("Location permission denied.");
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          setLocationStatus("Location unavailable.");
        } else if (error.code === error.TIMEOUT) {
          setLocationStatus("Location request timed out.");
        } else {
          setLocationStatus("Location check failed.");
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 15000,
        timeout: 12000,
      },
    );
  }

  function confirmSuggestion() {
    if (!nearestSuggestion) return;
    setSelectedGroupId(nearestSuggestion.clusterId || "__unclustered");
    dispatch({ type: "select-dealership", dealershipId: nearestSuggestion.id });
    setLocationStatus(`${nearestSuggestion.name} confirmed as the active lead.`);
  }

  function dismissSuggestion() {
    if (!nearestSuggestion) return;
    setDismissedSuggestionId(nearestSuggestion.id);
    setLocationStatus("Suggestion dismissed. Choose the dealership manually below.");
  }

  async function copyAsk() {
    const text = `${selectedDealership.roleHint || "Ask for showroom manager"}. If unavailable, ask for the Dealer Principal or owner.`;
    try {
      await window.navigator.clipboard.writeText(text);
    } catch {
      // Clipboard may be unavailable in some mobile browsers.
    }
  }

  function stopGuidedCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
    }
    setCameraStream(null);
    setGuidedCameraOpen(false);
  }

  async function openGuidedCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("In-app camera is unavailable in this browser. Use Upload photo instead.");
      return;
    }

    setCameraError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      setCameraStream(stream);
      setGuidedCameraOpen(true);
      setOcrStatus("Align the business card inside the frame, then capture.");
    } catch (error) {
      setCameraError(error?.message || "Camera permission was denied or unavailable.");
    }
  }

  function captureGuidedPhoto() {
    const video = cameraVideoRef.current;
    const canvas = cameraCanvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      setCameraError("Camera preview is not ready yet.");
      return;
    }

    const cardAspectRatio = 1.586;
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    let cropWidth = sourceWidth * 0.82;
    let cropHeight = cropWidth / cardAspectRatio;
    if (cropHeight > sourceHeight * 0.72) {
      cropHeight = sourceHeight * 0.72;
      cropWidth = cropHeight * cardAspectRatio;
    }

    const cropX = (sourceWidth - cropWidth) / 2;
    const cropY = (sourceHeight - cropHeight) / 2;
    canvas.width = Math.round(cropWidth);
    canvas.height = Math.round(cropHeight);

    const context = canvas.getContext("2d");
    context.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);

    const imageDataUrl = canvas.toDataURL("image/jpeg", 0.92);
    setCapturedFileName(`guided-card-${Date.now()}.jpg`);
    setCapturedImageUrl(imageDataUrl);
    setOcrStatus("Cropped card image ready. Run OCR to populate the form.");
    setOcrError("");
    setOcrCompleted(false);
    setCameraError("");
    setOcrFields(defaultFields(selectedDealership, latestContact));
    stopGuidedCamera();
  }

  async function onCaptureFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setCapturedFileName(file.name);
      setCapturedImageUrl(String(reader.result || ""));
      setOcrStatus("Contact media ready. Run OCR to populate the form.");
      setOcrError("");
      setOcrCompleted(false);
      setOcrFields(defaultFields(selectedDealership, latestContact));
    };
    reader.readAsDataURL(file);
  }

  async function runOcr() {
    if (!capturedImageUrl) {
      setOcrError("Capture or upload a business card first");
      return;
    }

    setOcrBusy(true);
    setOcrError("");
    setOcrStatus("Reading card with server-side Qwen OCR");
    try {
      const result = await runOpenRouterBusinessCardOcr({
        imageDataUrl: capturedImageUrl,
        dealershipName: selectedDealership.name,
      });
      setOcrFields(result);
      setOcrCompleted(true);
      setOcrStatus("OCR populated the fields. Check them, then save.");
    } catch (error) {
      setOcrError(error.message || "OCR failed");
      setOcrCompleted(false);
      setOcrStatus("OCR failed");
    } finally {
      setOcrBusy(false);
    }
  }

  function saveContact(openEmail = false) {
    dispatch({
      type: "save-ocr-contact",
      dealershipId: selectedDealership.id,
      payload: {
        ...ocrFields,
        fileName: capturedFileName || "captured-contact",
        mediaType: "business_card",
        source: ocrCompleted ? "server-qwen" : "manual",
      },
    });
    setOcrStatus(openEmail ? "Contact saved and email draft primed" : "Contact saved into lead card");
    setOcrError("");
    if (openEmail) navigate("/email");
  }

  return (
    <AppLayout statusLine={`Lead capture - ${selectedCluster.name}`}>
      <section className="title-row">
        <div>
          <div className="kicker">Leads intel</div>
          <h1>Choose the dealership, capture the card, save the contact.</h1>
        </div>
      </section>

      <input id="contact-upload-input" className="sr-only-input" type="file" accept="image/*" onChange={onCaptureFile} />
      <canvas ref={cameraCanvasRef} className="sr-only-input" aria-hidden="true" />

      <section className="panel pad" style={{ marginBottom: 14 }}>
        <div className="section-head">
          <div>
            <div className="kicker">Active dealership</div>
            <h2>{selectedDealership.name}</h2>
          </div>
          <span className={`pill${selectedDealership.isManual ? " active" : ""}`}>
            {selectedDealership.isManual ? "Manual pin" : "Mapped pin"}
          </span>
        </div>

        <div className="grid two compact-form">
          <div className="field">
            <label>Cluster or standalone dealership</label>
            <select className="text-input" value={selectedGroupId} onChange={(event) => handleGroupChange(event.target.value)}>
              {clusters.map((cluster) => (
                <option key={cluster.id} value={cluster.id}>
                  {cluster.name}
                </option>
              ))}
              {unclusteredDealerships.length ? <option value="__unclustered">Unclustered dealerships</option> : null}
            </select>
          </div>
          <div className="field">
            <label>Dealership</label>
            <select
              className="text-input"
              value={selectedDealershipInGroup ? selectedDealership.id : ""}
              onChange={(event) => handleDealershipChange(event.target.value)}
              disabled={!selectedGroupDealerships.length}
            >
              {!selectedGroupDealerships.length ? <option value="">No dealerships in this group</option> : null}
              {selectedGroupDealerships.map((dealership) => (
                <option key={dealership.id} value={dealership.id}>
                  {dealership.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="feed-forward">
          <span className={`flow-dot${locationBusy ? " active" : ""}`}></span>
          <div>
            <b>Location suggestion</b>
            <small>{locationStatus}</small>
          </div>
        </div>

        {nearestSuggestion ? (
          <div className="inline-alert">
            Suggested: {nearestSuggestion.name} ({formatMiles(nearestSuggestion.distanceMiles)})
          </div>
        ) : null}

        <div className="action-row">
          <button className="btn" type="button" disabled={locationBusy} onClick={suggestNearestDealership}>
            {locationBusy ? "Checking location" : "Use my location"}
          </button>
          <button className="btn primary" type="button" disabled={!nearestSuggestion} onClick={confirmSuggestion}>
            Confirm suggestion
          </button>
          <button className="btn" type="button" disabled={!nearestSuggestion} onClick={dismissSuggestion}>
            Not this one
          </button>
        </div>
      </section>

      <section className="grid two">
        <article className="panel pad capture-card">
          <div className="section-head">
            <div>
              <div className="kicker">Qwen OCR capture</div>
              <h2>Business card or contact photo</h2>
            </div>
            <span className="pill active">Server OCR</span>
          </div>
          <p>Capture the card first. OCR fills the contact fields beside this panel, then you check and save.</p>

          <div className="capture-preview">
            {capturedImageUrl ? (
              <img src={capturedImageUrl} alt="Captured contact material" />
            ) : (
              <div className="capture-empty">No capture yet</div>
            )}
          </div>

          <div className="feed-forward">
            <span className={`flow-dot${ocrBusy ? " active" : ""}`}></span>
            <div>
              <b>OCR status</b>
              <small>{ocrStatus}</small>
            </div>
          </div>

          {ocrError ? <div className="inline-alert error">{ocrError}</div> : null}
          {cameraError ? <div className="inline-alert error">{cameraError}</div> : null}

          {guidedCameraOpen ? (
            <div className="guided-camera">
              <div className="guided-camera-view">
                <video ref={cameraVideoRef} muted playsInline />
                <div className="card-guide">
                  <span></span>
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
              <div className="action-row">
                <button className="btn primary" type="button" onClick={captureGuidedPhoto}>
                  Capture card
                </button>
                <button className="btn" type="button" onClick={stopGuidedCamera}>
                  Close camera
                </button>
              </div>
            </div>
          ) : null}

          <div className="action-row">
            <label className="btn" htmlFor="contact-upload-input">
              Upload photo
            </label>
            <button className="btn primary" type="button" onClick={openGuidedCamera}>
              Use camera
            </button>
            <button className="btn primary" type="button" onClick={runOcr} disabled={!capturedImageUrl || ocrBusy}>
              {ocrBusy ? "Reading card" : "Run OCR"}
            </button>
          </div>
        </article>

        <article className="panel pad capture-card">
          <div className="section-head">
            <div>
              <div className="kicker">Auto-filled contact</div>
              <h2>Review before saving</h2>
            </div>
            <span className="pill">Editable</span>
          </div>

          <div className="grid two compact-form">
            <div className="field">
              <label>Name</label>
              <input className="text-input" value={ocrFields.name} onChange={(event) => updateField("name", event.target.value)} />
            </div>
            <div className="field">
              <label>Role</label>
              <input className="text-input" value={ocrFields.role} onChange={(event) => updateField("role", event.target.value)} />
            </div>
            <div className="field">
              <label>Email</label>
              <input className="text-input" value={ocrFields.email} onChange={(event) => updateField("email", event.target.value)} />
            </div>
            <div className="field">
              <label>Phone</label>
              <input className="text-input" value={ocrFields.phone} onChange={(event) => updateField("phone", event.target.value)} />
            </div>
            <div className="field">
              <label>Company</label>
              <input className="text-input" value={ocrFields.company} onChange={(event) => updateField("company", event.target.value)} />
            </div>
            <div className="field">
              <label>Suggested domain</label>
              <div className="draft small-draft">{suggestedDomain || "No website tagged on this dealership yet."}</div>
            </div>
          </div>

          <div className="field">
            <label>Raw OCR text</label>
            <textarea
              className="input"
              rows="4"
              value={ocrFields.rawText}
              onChange={(event) => updateField("rawText", event.target.value)}
              placeholder="OCR output or manual notes"
            />
          </div>

          <div className="inline-alert">
            {latestContact
              ? `Saved contact on this lead: ${latestContact.name}, ${latestContact.role}.`
              : "No saved contact yet. Saving here attaches the contact to this dealership."}
          </div>

          <div className="action-row">
            <button
              className="btn"
              type="button"
              onClick={() => saveContact(false)}
              disabled={!ocrFields.name && !ocrFields.email && !ocrFields.phone}
            >
              Save contact
            </button>
            <button
              className="btn primary"
              type="button"
              onClick={() => saveContact(true)}
              disabled={!ocrFields.name && !ocrFields.email && !ocrFields.phone}
            >
              Save and open email
            </button>
          </div>
        </article>
      </section>

      <section className="panel table" style={{ marginTop: 14 }}>
        <div className="row selected">
          <span className="number">01</span>
          <div>
            <h3>Dealership intel</h3>
            <small>
              {selectedDealership.contactHint}. {selectedDealership.parentGroup}.
            </small>
          </div>
          <span className="pill active">Context</span>
        </div>
        <div className="row">
          <span className="number">02</span>
          <div>
            <h3>Who to ask for</h3>
            <small>{selectedDealership.roleHint}. If unavailable, ask for the Dealer Principal or owner.</small>
          </div>
          <button className="btn" type="button" onClick={copyAsk}>
            Copy ask
          </button>
        </div>
        <div className="row">
          <span className="number">03</span>
          <div>
            <h3>Property angle</h3>
            <small>{selectedDealership.pitch}</small>
          </div>
          <span className="pill">Pitch</span>
        </div>
      </section>
    </AppLayout>
  );
}
