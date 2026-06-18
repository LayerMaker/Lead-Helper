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

export function LeadsPage() {
  const navigate = useNavigate();
  const {
    clusters,
    dealerships,
    selectedCluster,
    selectedDealership,
    getDealershipsForCluster,
    getLatestContact,
    getLatestVisit,
    getLatestMedia,
    settings,
    dispatch,
  } = useAppState();
  const dealers = getDealershipsForCluster(selectedCluster.id);
  const latestContact = getLatestContact(selectedDealership.id);
  const latestVisit = getLatestVisit(selectedDealership.id);
  const latestMedia = getLatestMedia(selectedDealership.id);
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

  function formatMiles(value) {
    if (!Number.isFinite(value)) return "";
    return `${value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")} mi`;
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

  async function onCaptureFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setCapturedFileName(file.name);
      setCapturedImageUrl(String(reader.result || ""));
      setOcrStatus("Contact media ready");
      setOcrError("");
      setOcrFields(defaultFields(selectedDealership, latestContact));
    };
    reader.readAsDataURL(file);
  }

  async function runOcr() {
    if (!capturedImageUrl) {
      setOcrError("Capture a business card or contact photo first");
      return;
    }
    if (!settings?.openRouterApiKey) {
      setOcrError("Add your OpenRouter API key in Settings before running OCR");
      return;
    }

    setOcrBusy(true);
    setOcrError("");
    setOcrStatus("Running Qwen OCR");
    try {
      const result = await runOpenRouterBusinessCardOcr({
        apiKey: settings.openRouterApiKey,
        model: settings.ocrModel,
        imageDataUrl: capturedImageUrl,
        dealershipName: selectedDealership.name,
      });
      setOcrFields(result);
      setOcrStatus("OCR extraction ready for review");
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
    <AppLayout statusLine={`Geolocation dealership intel - ${selectedCluster.name} route`}>
      <section className="title-row">
        <div>
          <div className="kicker">Leads intel</div>
          <h1>Detect the nearest dealership and capture the right contact material.</h1>
        </div>
        <div className="action-row">
          <label className="btn" htmlFor="contact-upload-input">
            Upload photo
          </label>
          <label className="btn primary" htmlFor="contact-camera-input">
            Use camera
          </label>
        </div>
      </section>

      <input
        id="contact-upload-input"
        className="sr-only-input"
        type="file"
        accept="image/*"
        onChange={onCaptureFile}
      />
      <input
        id="contact-camera-input"
        className="sr-only-input"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onCaptureFile}
      />

      <section className="grid two" style={{ marginBottom: 14 }}>
        <article className="panel pad">
          <div className="section-head">
            <div>
              <div className="kicker">Choose active dealership</div>
              <h2>{selectedDealership.name}</h2>
            </div>
            <span className={`pill${selectedDealership.isManual ? " active" : ""}`}>
              {selectedDealership.isManual ? "Manual pin" : "Mapped pin"}
            </span>
          </div>
          <p className="subtle-copy">
            Pick the dealership before adding contact data. The OCR, notes, email draft, and report row all attach to this active lead.
          </p>

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
                value={selectedDealership.id}
                onChange={(event) => handleDealershipChange(event.target.value)}
                disabled={!selectedGroupDealerships.length}
              >
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
        </article>

        <aside className="panel table">
          <div className="row selected">
            <span className="number">01</span>
            <div>
              <h3>Active lead</h3>
              <small>{selectedDealership.address || "No address saved yet."}</small>
            </div>
            <span className="pill active">{selectedCluster.name}</span>
          </div>
          <div className="row">
            <span className="number">02</span>
            <div>
              <h3>Known contact</h3>
              <small>
                {latestContact
                  ? `${latestContact.name}, ${latestContact.role} - ${latestContact.email || latestContact.phone || "saved contact"}`
                  : "No contact saved yet. Capture or upload a card below."}
              </small>
            </div>
            <span className={`pill${latestContact ? " active" : ""}`}>{latestContact ? "Saved" : "Empty"}</span>
          </div>
          <div className="row">
            <span className="number">03</span>
            <div>
              <h3>Next data step</h3>
              <small>{latestContact ? "Review/update contact details or open an email draft." : "Capture contact media and run OCR."}</small>
            </div>
            <span className="pill">Lead data</span>
          </div>
        </aside>
      </section>

      <section className="grid two">
        <div className="panel pad">
          <div className="section-head">
            <div>
              <div className="kicker">Nearest detected</div>
              <h2>{selectedDealership.name}</h2>
            </div>
            <span className="pill active">{selectedDealership.intelDistance || "82 m"}</span>
          </div>
          <p>GPS and scraped map pins place you beside {selectedDealership.name}. Use this intel before walking through the door.</p>
          <div className="geo-radar">
            <span className="scan-ring"></span>
            <span className="scan-ring two"></span>
            <span className="user-dot"></span>
            {dealers.slice(0, 3).map((dealer) => (
              <button
                key={dealer.id}
                className={`dealer-pin${dealer.id === selectedDealership.id ? " warm" : dealer.status === "Follow-up due" ? " due" : ""}`}
                style={{ left: `${dealer.radar.left}%`, top: `${dealer.radar.top}%` }}
                type="button"
                onClick={() => dispatch({ type: "select-dealership", dealershipId: dealer.id })}
              >
                {dealer.shortName}
              </button>
            ))}
          </div>
          <div className="action-row">
            <label className="btn" htmlFor="contact-upload-input">
              Upload card
            </label>
            <label className="btn primary" htmlFor="contact-camera-input">
              Camera
            </label>
          </div>
        </div>

        <aside className="panel table">
          <div className="row selected">
            <span className="number">01</span>
            <div>
              <h3>Scraped contact / intel</h3>
              <small>
                {selectedDealership.contactHint}. {selectedDealership.parentGroup}.
              </small>
            </div>
            <span className="pill active">High fit</span>
          </div>
          <div className="row">
            <span className="number">02</span>
            <div>
              <h3>Who to ask for</h3>
              <small>
                {selectedDealership.roleHint}. If unavailable, ask for the Dealer Principal or owner.
              </small>
            </div>
            <button className="btn" type="button">
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
          <div className="row">
            <span className="number">04</span>
            <div>
              <h3>Latest captured contact</h3>
              <small>
                {latestContact
                  ? `${latestContact.name}, ${latestContact.role} - ${latestContact.email}`
                  : "No verified contact yet. Capture card recommended."}
              </small>
            </div>
            <span className={`pill${latestContact ? " active" : ""}`}>{latestContact ? "Synced" : "Pending"}</span>
          </div>
          <div className="row">
            <span className="number">05</span>
            <div>
              <h3>Last visit input</h3>
              <small>{latestVisit ? latestVisit.outcomes.join(", ") : "No visit captured for this dealership yet."}</small>
            </div>
            <span className="pill">Visit</span>
          </div>
          <div className="row">
            <span className="number">06</span>
            <div>
              <h3>Latest media record</h3>
              <small>{latestMedia ? `${latestMedia.fileName || latestMedia.type} - ${latestMedia.status}` : "No media logged yet."}</small>
            </div>
            <span className={`pill${latestMedia ? " active" : ""}`}>{latestMedia ? "Captured" : "Empty"}</span>
          </div>
        </aside>
      </section>

      <section className="grid two" style={{ marginTop: 14 }}>
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
          <p>Capture contact media on your phone, then run OCR and correct any fields before saving the contact.</p>

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
              Upload another
            </label>
            <label className="btn" htmlFor="contact-camera-input">
              Replace image
            </label>
            <button className="btn primary" type="button" onClick={runOcr} disabled={!capturedImageUrl || ocrBusy}>
              {ocrBusy ? "Running OCR" : "Run Qwen OCR"}
            </button>
          </div>
        </article>

        <article className="panel pad capture-card">
          <div className="section-head">
            <div>
              <div className="kicker">Verify extracted fields</div>
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

          <div className="action-row">
            <button
              className="btn"
              type="button"
              onClick={() => saveContact(false)}
              disabled={!ocrFields.name && !ocrFields.email && !ocrFields.phone}
            >
              Save contact to lead
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
    </AppLayout>
  );
}
