import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "../components/AppLayout";
import { runOpenRouterBusinessCardOcr } from "../lib/ocrService";
import { geocodeAddress } from "../lib/osmService";
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
  const [manualBusy, setManualBusy] = useState(false);
  const [manualStatus, setManualStatus] = useState("Add an off-map dealership when you find a real lead outside the scraped pins.");
  const [manualError, setManualError] = useState("");
  const [manualForm, setManualForm] = useState({
    name: "",
    address: "",
    clusterId: selectedCluster.id,
    website: "",
    phone: "",
    roleHint: "",
    contactHint: "",
  });

  const suggestedDomain = useMemo(() => selectedDealership.website || "", [selectedDealership.website]);

  useEffect(() => {
    if (previousDealershipIdRef.current === selectedDealership.id) return;
    previousDealershipIdRef.current = selectedDealership.id;
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

  function updateManualField(key, value) {
    setManualForm((current) => ({
      ...current,
      [key]: value,
    }));
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

  async function addManualDealership() {
    const name = manualForm.name.trim();
    const address = manualForm.address.trim();

    if (!name || !address) {
      setManualError("Add both a dealership name and address.");
      return;
    }

    setManualBusy(true);
    setManualError("");
    setManualStatus("Resolving address against OpenStreetMap");

    try {
      const [bestMatch] = await geocodeAddress(address);
      dispatch({
        type: "upsert-manual-dealership",
        payload: {
          name,
          address,
          clusterId: manualForm.clusterId || selectedCluster.id,
          website: manualForm.website.trim(),
          phone: manualForm.phone.trim(),
          roleHint: manualForm.roleHint.trim(),
          contactHint: manualForm.contactHint.trim(),
          location: [bestMatch.lat, bestMatch.lng],
          geocodeLabel: bestMatch.displayName,
          intelDistance: "Manual add",
          nextAction: "Capture contact and log visit outcomes",
        },
      });
      setManualStatus(`Pinned to the map from: ${bestMatch.displayName}`);
      setManualForm((current) => ({
        ...current,
        name: "",
        address: "",
        website: "",
        phone: "",
        roleHint: "",
        contactHint: "",
      }));
    } catch (error) {
      setManualError(error.message || "Address lookup failed.");
      setManualStatus("Manual add needs a valid map match before it can join the cluster.");
    } finally {
      setManualBusy(false);
    }
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
              <div className="kicker">Off-map dealership</div>
              <h2>Add a real-world lead into the live cluster</h2>
            </div>
            <span className="pill">Manual intake</span>
          </div>
          <p>
            Use this when you physically find a showroom that missed the scrape. We geocode the address, pin it to the map, and
            make it behave like every other dealership in route, email, and reports.
          </p>

          <div className="grid two compact-form">
            <div className="field">
              <label>Dealership name</label>
              <input
                className="text-input"
                value={manualForm.name}
                onChange={(event) => updateManualField("name", event.target.value)}
                placeholder="Auto West London OMODA & JAECOO"
              />
            </div>
            <div className="field">
              <label>Assign to cluster</label>
              <select
                className="text-input"
                value={manualForm.clusterId}
                onChange={(event) => updateManualField("clusterId", event.target.value)}
              >
                {clusters.map((cluster) => (
                  <option key={cluster.id} value={cluster.id}>
                    {cluster.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Street address</label>
              <input
                className="text-input"
                value={manualForm.address}
                onChange={(event) => updateManualField("address", event.target.value)}
                placeholder="109 Devonshire Rd, Chiswick, London W4 2AN"
              />
            </div>
            <div className="field">
              <label>Website</label>
              <input
                className="text-input"
                value={manualForm.website}
                onChange={(event) => updateManualField("website", event.target.value)}
                placeholder="autowestlondon.co.uk"
              />
            </div>
            <div className="field">
              <label>Phone</label>
              <input
                className="text-input"
                value={manualForm.phone}
                onChange={(event) => updateManualField("phone", event.target.value)}
                placeholder="02039 317860"
              />
            </div>
            <div className="field">
              <label>Who to ask for</label>
              <input
                className="text-input"
                value={manualForm.roleHint}
                onChange={(event) => updateManualField("roleHint", event.target.value)}
                placeholder="Showroom manager or dealer principal"
              />
            </div>
            <div className="field">
              <label>Contact hint</label>
              <input
                className="text-input"
                value={manualForm.contactHint}
                onChange={(event) => updateManualField("contactHint", event.target.value)}
                placeholder="Met on site, brochure already sent"
              />
            </div>
          </div>

          <div className="feed-forward">
            <span className={`flow-dot${manualBusy ? " active" : ""}`}></span>
            <div>
              <b>Manual pin status</b>
              <small>{manualStatus}</small>
            </div>
          </div>

          {manualError ? <div className="inline-alert error">{manualError}</div> : null}

          <div className="action-row">
            <button className="btn primary" type="button" disabled={manualBusy} onClick={addManualDealership}>
              {manualBusy ? "Pinning dealership" : "Add dealership to map"}
            </button>
          </div>
        </article>

        <article className="panel pad">
          <div className="section-head">
            <div>
              <div className="kicker">Active lead card</div>
              <h2>{selectedDealership.name}</h2>
            </div>
            <span className={`pill${selectedDealership.isManual ? " active" : ""}`}>
              {selectedDealership.isManual ? "Manual pin" : "Scraped pin"}
            </span>
          </div>
          <p>
            {selectedDealership.address}
            {selectedDealership.geocodeLabel ? ` - ${selectedDealership.geocodeLabel}` : ""}
          </p>
          <div className="grid two compact-form">
            <div className="field">
              <label>Cluster</label>
              <div className="draft small-draft">{selectedCluster.name}</div>
            </div>
            <div className="field">
              <label>Map source</label>
              <div className="draft small-draft">{selectedDealership.sourceLabel || selectedDealership.sourceType || "Scrape"}</div>
            </div>
            <div className="field">
              <label>Website</label>
              <div className="draft small-draft">{selectedDealership.website || "No website saved yet."}</div>
            </div>
            <div className="field">
              <label>Phone</label>
              <div className="draft small-draft">{selectedDealership.phone || "No phone saved yet."}</div>
            </div>
          </div>
        </article>
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
