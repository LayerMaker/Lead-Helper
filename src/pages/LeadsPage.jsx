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
    settings,
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
  const [selectedGroupId, setSelectedGroupId] = useState(selectedCluster.id);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationStatus, setLocationStatus] = useState("Use location to suggest the nearest dealership.");
  const [locationSuggestion, setLocationSuggestion] = useState(null);
  const [dismissedSuggestionId, setDismissedSuggestionId] = useState("");

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
    setOcrStatus("No contact media captured yet");
  }, [latestContact, selectedDealership]);

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

  async function onCaptureFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setCapturedFileName(file.name);
      setCapturedImageUrl(String(reader.result || ""));
      setOcrStatus("Contact media ready. Run OCR to populate the form.");
      setOcrError("");
      setOcrFields(defaultFields(selectedDealership, latestContact));
    };
    reader.readAsDataURL(file);
  }

  async function runOcr() {
    if (!capturedImageUrl) {
      setOcrError("Capture or upload a business card first");
      return;
    }
    if (!settings?.openRouterApiKey) {
      setOcrError("Add your OpenRouter API key in Settings before running OCR");
      return;
    }

    setOcrBusy(true);
    setOcrError("");
    setOcrStatus("Reading card with Qwen OCR");
    try {
      const result = await runOpenRouterBusinessCardOcr({
        apiKey: settings.openRouterApiKey,
        model: settings.ocrModel,
        imageDataUrl: capturedImageUrl,
        dealershipName: selectedDealership.name,
      });
      setOcrFields(result);
      setOcrStatus("OCR populated the fields. Check them, then save.");
    } catch (error) {
      setOcrError(error.message || "OCR failed");
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
        source: settings?.openRouterApiKey ? "openrouter-qwen" : "manual",
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
      <input
        id="contact-camera-input"
        className="sr-only-input"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onCaptureFile}
      />

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
            <span className={`pill${settings?.openRouterApiKey ? " active" : ""}`}>
              {settings?.openRouterApiKey ? settings.ocrModel : "Configure OCR in Settings"}
            </span>
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

          <div className="action-row">
            <label className="btn" htmlFor="contact-upload-input">
              Upload photo
            </label>
            <label className="btn primary" htmlFor="contact-camera-input">
              Use camera
            </label>
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
