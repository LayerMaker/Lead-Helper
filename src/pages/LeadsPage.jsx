import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "../components/AppLayout";
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
