import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  buildAdminEntries,
  buildEmailDraft,
  buildMailtoDraftUrl,
  buildOutlookComposeUrl,
  buildSuggestedRecipientOptions,
  deriveEmailType,
  emailTypeCatalog,
} from "../lib/leadHelperModel";
import { generateOpenRouterEmailDraft } from "../lib/emailService";
import { AppLayout } from "../components/AppLayout";
import { useAppState } from "../state/AppState";

const fgiOptions = [
  "Met manager",
  "Interested",
  "Needs email",
  "Follow-up required",
  "Deferred to decision maker",
  "Card captured",
  "Site walk booked",
  "Not suitable",
];

function normalizeDraftState({ state, dealershipId, outcomes, preferredType, storedDraft }) {
  const generated = buildEmailDraft(state, dealershipId, outcomes, { emailType: preferredType });
  const nextType = storedDraft?.emailType || generated.emailType;
  const nextGenerated = buildEmailDraft(state, dealershipId, outcomes, { emailType: nextType });
  const suggestedRecipients = buildSuggestedRecipientOptions(state, dealershipId);

  return {
    outcomes,
    emailType: nextType,
    toAddress: storedDraft?.toAddress || suggestedRecipients[0]?.address || "",
    subject: storedDraft?.subject || nextGenerated.subject,
    body: storedDraft?.body || nextGenerated.body,
    generationMode: storedDraft?.generationMode || state.settings?.emailGenerationMode || "template",
  };
}

function EmailComposer({ state, settings, selectedDealership, selectedCluster, latestVisit, storedDraft, contact, latestMedia, dispatch }) {
  const initialComposerState = normalizeDraftState({
    state,
    dealershipId: selectedDealership.id,
    outcomes: storedDraft?.outcomes || latestVisit?.outcomes || ["Met manager", "Interested", "Needs email"],
    preferredType: storedDraft?.emailType,
    storedDraft,
  });
  const [selectedOutcomes, setSelectedOutcomes] = useState(initialComposerState.outcomes);
  const [emailType, setEmailType] = useState(initialComposerState.emailType);
  const [toAddress, setToAddress] = useState(initialComposerState.toAddress);
  const [subject, setSubject] = useState(initialComposerState.subject);
  const [body, setBody] = useState(initialComposerState.body);
  const [generationMode, setGenerationMode] = useState(initialComposerState.generationMode || settings?.emailGenerationMode || "template");
  const [saveState, setSaveState] = useState(storedDraft?.status === "sent" ? "Sent" : storedDraft ? "Saved draft" : "Draft not saved");
  const [busyState, setBusyState] = useState("");
  const [errorState, setErrorState] = useState("");

  const adminEntries = useMemo(() => buildAdminEntries(selectedOutcomes), [selectedOutcomes]);
  const suggestedRecipients = useMemo(
    () => buildSuggestedRecipientOptions(state, selectedDealership.id),
    [selectedDealership.id, state],
  );
  const ocrRecipientCount = useMemo(
    () => suggestedRecipients.filter((item) => item.source === "OCR capture").length,
    [suggestedRecipients],
  );
  const generatedTemplate = useMemo(
    () => buildEmailDraft(state, selectedDealership.id, selectedOutcomes, { emailType }),
    [emailType, selectedDealership.id, selectedOutcomes, state],
  );

  function toggleOutcome(outcome) {
    setSelectedOutcomes((current) => {
      const next = current.includes(outcome) ? current.filter((item) => item !== outcome) : [...current, outcome];
      const derivedType = deriveEmailType(next, emailType);
      const refreshed = buildEmailDraft(state, selectedDealership.id, next, { emailType: derivedType });
      setEmailType(derivedType);
      setSubject(refreshed.subject);
      setBody(refreshed.body);
      setSaveState("Draft changed");
      return next;
    });
  }

  function chooseEmailType(nextType) {
    const refreshed = buildEmailDraft(state, selectedDealership.id, selectedOutcomes, { emailType: nextType });
    setEmailType(nextType);
    setSubject(refreshed.subject);
    setBody(refreshed.body);
    setSaveState("Draft changed");
  }

  function rebuildTemplate() {
    const refreshed = buildEmailDraft(state, selectedDealership.id, selectedOutcomes, { emailType });
    setSubject(refreshed.subject);
    setBody(refreshed.body);
    setGenerationMode("template");
    setSaveState("Template rebuilt");
    setErrorState("");
  }

  function buildDraftPayload(modeOverride) {
    return {
      emailType,
      toAddress,
      subject,
      body,
      generationMode: modeOverride || generationMode,
    };
  }

  function saveDraft(modeOverride) {
    dispatch({
      type: "save-email-draft",
      dealershipId: selectedDealership.id,
      outcomes: selectedOutcomes,
      status: "draft",
      draft: buildDraftPayload(modeOverride),
    });
    setSaveState("Saved draft");
    setErrorState("");
  }

  async function copyDraft() {
    try {
      await window.navigator.clipboard.writeText(`To: ${toAddress}\nSubject: ${subject}\n\n${body}`);
      setSaveState("Copied to clipboard");
    } catch {
      setErrorState("Clipboard access was blocked in this browser.");
    }
  }

  function openSendSurface(modeOverride) {
    const mode = modeOverride || settings?.preferredSendMode || "mailto";
    const to = mode === "self" ? settings?.workEmail || toAddress : toAddress;
    const mailtoUrl = buildMailtoDraftUrl({
      toAddress: to,
      subject,
      body,
    });
    const outlookUrl = buildOutlookComposeUrl({
      toAddress: to,
      subject,
      body,
    });

    if (mode === "outlook") {
      window.open(outlookUrl, "_blank", "noopener,noreferrer");
      setSaveState("Opened in Outlook");
      return;
    }

    window.location.href = mailtoUrl;
    setSaveState(mode === "self" ? "Sent to self handoff opened" : "Mail app opened");
  }

  async function runAi(mode) {
    setBusyState(mode === "generate" ? "Generating draft..." : "Polishing draft...");
    setErrorState("");

    try {
      const result = await generateOpenRouterEmailDraft({
        model: settings?.emailModel,
        dealership: selectedDealership,
        contact,
        latestVisit,
        outcomes: selectedOutcomes,
        emailType,
        templateSubject: subject || generatedTemplate.subject,
        templateBody: body || generatedTemplate.body,
        selectedAddress: toAddress,
        mode,
      });

      setSubject(result.subject);
      setBody(result.body);
      setGenerationMode(mode);
      setSaveState(mode === "generate" ? "AI draft ready" : "AI polish ready");

      dispatch({
        type: "save-email-draft",
        dealershipId: selectedDealership.id,
        outcomes: selectedOutcomes,
        status: "draft",
        draft: {
          ...buildDraftPayload(mode),
          subject: result.subject,
          body: result.body,
          generationMode: mode,
        },
      });
    } catch (error) {
      setErrorState(error.message || "Email generation failed.");
    } finally {
      setBusyState("");
    }
  }

  function markSent() {
    dispatch({
      type: "send-email",
      dealershipId: selectedDealership.id,
      outcomes: selectedOutcomes,
      draft: buildDraftPayload(),
    });
    setSaveState("Sent");
    setErrorState("");
  }

  return (
    <section className="grid two">
      <div className="panel pad email-config">
        <div className="field">
          <label>Dealership</label>
          <div className="draft">{selectedDealership.name}</div>
        </div>

        <div className="field">
          <label>Primary contact</label>
          <div className="draft">
            {contact
              ? `${contact.name}, ${contact.role}${contact.email ? ` - ${contact.email}` : ""}`
              : "No verified contact yet. Capture a card or contact photo in Leads."}
          </div>
        </div>

        <div className="field">
          <label>Frequently given input</label>
          <div className="outcomes">
            {fgiOptions.map((outcome) => (
              <button
                key={outcome}
                className={`chip${selectedOutcomes.includes(outcome) ? " selected" : ""}`}
                type="button"
                onClick={() => toggleOutcome(outcome)}
              >
                {outcome}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Email type</label>
          <div className="outcomes">
            {emailTypeCatalog.map((option) => (
              <button
                key={option}
                className={`chip${emailType === option ? " selected" : ""}`}
                type="button"
                onClick={() => chooseEmailType(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Suggested addresses from scrape / OCR</label>
          <div className="outcomes">
            {suggestedRecipients.length ? (
              suggestedRecipients.map((recipient) => (
                <button
                  key={`${recipient.address}-${recipient.source}`}
                  className={`chip${toAddress === recipient.address ? " selected" : ""}`}
                  type="button"
                  onClick={() => {
                    setToAddress(recipient.address);
                    setSaveState("Draft changed");
                  }}
                  title={`${recipient.source}: ${recipient.label}`}
                >
                  {recipient.address}
                </button>
              ))
            ) : (
              <span className="pill">No suggestions yet</span>
            )}
          </div>
          {suggestedRecipients.length ? (
            <small className="muted-copy">
              {ocrRecipientCount
                ? `${ocrRecipientCount} address${ocrRecipientCount === 1 ? "" : "es"} found from OCR capture.`
                : "Suggestions built from the saved contact and dealership website."}
            </small>
          ) : null}
        </div>

        <div className="field">
          <label>To address</label>
          <input
            className="text-input"
            type="email"
            value={toAddress}
            onChange={(event) => {
              setToAddress(event.target.value);
              setSaveState("Draft changed");
            }}
            placeholder="manager@dealership.co.uk"
          />
        </div>

        <div className="admin-actions">
          {adminEntries.map((entry, index) => (
            <div className={`row${index === 0 ? " selected" : ""}`} key={`${entry.label}-${index}`}>
              <span className="number">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3>{entry.label}</h3>
                <small>{entry.detail}</small>
              </div>
              <span className={`pill${index === 0 ? " active" : ""}`}>{entry.type}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel pad email-composer-panel">
        <div className="section-head">
          <div>
            <div className="kicker">Live draft</div>
            <h2>{emailType}</h2>
          </div>
          <span className={`pill${storedDraft?.status === "sent" || saveState === "Sent" ? "" : " active"}`}>{saveState}</span>
        </div>

        <div className="composer-meta">
          <span className={`pill${generationMode !== "template" ? " active" : ""}`}>Mode: {generationMode}</span>
          <span className="pill">Cluster: {selectedCluster.name}</span>
          <span className="pill">{latestMedia?.rawText ? "OCR linked" : "No OCR text linked"}</span>
          <span className={`pill${contact?.email ? " active" : ""}`}>{contact?.email ? "Recipient ready" : "Recipient unverified"}</span>
          <span className="pill">Send: {settings?.preferredSendMode || "mailto"}</span>
        </div>

        {busyState ? <div className="inline-alert">{busyState}</div> : null}
        {errorState ? <div className="inline-alert error">{errorState}</div> : null}

        <div className="field">
          <label>Subject</label>
          <input
            className="text-input"
            value={subject}
            onChange={(event) => {
              setSubject(event.target.value);
              setSaveState("Draft changed");
            }}
            placeholder="Battersea site details for dealership"
          />
        </div>

        <div className="field">
          <label>Email body</label>
          <textarea
            className="input email-body"
            rows="12"
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
              setSaveState("Draft changed");
            }}
            placeholder="Your follow-up email will appear here."
          />
        </div>

        <div className="segmented three-way">
          {[
            { value: "template", label: "Template" },
            { value: "polish", label: "Polish" },
            { value: "generate", label: "Generate" },
          ].map((option) => (
            <button
              key={option.value}
              className={generationMode === option.value ? "active" : ""}
              type="button"
              onClick={() => setGenerationMode(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="action-row" style={{ marginTop: 12 }}>
          <button className="btn" type="button" onClick={rebuildTemplate}>
            Rebuild template
          </button>
          <button className="btn" type="button" onClick={() => saveDraft()}>
            Save draft
          </button>
          <button className="btn" type="button" onClick={copyDraft}>
            Copy
          </button>
          <button className="btn" type="button" onClick={() => openSendSurface("mailto")}>
            Open mail app
          </button>
          <button className="btn" type="button" onClick={() => openSendSurface("outlook")}>
            Outlook web
          </button>
          <button className="btn" type="button" disabled={!settings?.workEmail} onClick={() => openSendSurface("self")}>
            Send to self
          </button>
          <button
            className="btn"
            type="button"
            disabled={Boolean(busyState)}
            onClick={() => runAi("polish")}
          >
            AI polish
          </button>
          <button
            className="btn"
            type="button"
            disabled={Boolean(busyState)}
            onClick={() => runAi("generate")}
          >
            AI generate
          </button>
          <button className="btn primary" type="button" onClick={markSent}>
            Mark sent
          </button>
        </div>

        <div className="feed-forward email-feed-forward">
          <span className="flow-dot"></span>
          <div>
            <b>Also updates</b>
            <small>
              {adminEntries.length} admin actions will feed Dashboard and the {selectedCluster.name} report cards.
            </small>
          </div>
          <Link className="btn" to="/reports">
            Open reports
          </Link>
        </div>
      </div>
    </section>
  );
}

export function EmailPage() {
  const {
    state,
    settings,
    selectedDealership,
    getLatestContact,
    getLatestMedia,
    getLatestVisit,
    getDraftForDealership,
    dispatch,
    selectedCluster,
  } = useAppState();
  const latestVisit = getLatestVisit(selectedDealership.id);
  const storedDraft = getDraftForDealership(selectedDealership.id);
  const contact = getLatestContact(selectedDealership.id);
  const latestMedia = getLatestMedia(selectedDealership.id);

  return (
    <AppLayout statusLine="Frequently given input engine">
      <section className="title-row">
        <div>
          <div className="kicker">FGI Email</div>
          <h1>Turn visit outcomes into a recipient-ready follow-up without leaving the field workflow.</h1>
        </div>
        <Link className="btn primary" to="/leads">
          Open contact intel
        </Link>
      </section>

      <section className="pipeline-strip panel pad">
        <div>
          <span className="flow-dot active"></span>
          <b>Outcome chips</b>
          <small>What happened on the visit</small>
        </div>
        <div>
          <span className="flow-dot"></span>
          <b>Recipients</b>
          <small>From scrape, OCR, or manual edit</small>
        </div>
        <div>
          <span className="flow-dot"></span>
          <b>Draft engine</b>
          <small>Template, polish, or generate</small>
        </div>
        <div>
          <span className="flow-dot"></span>
          <b>Admin trail</b>
          <small>Feeds dashboard actions and reports</small>
        </div>
      </section>

      <EmailComposer
        key={`${selectedDealership.id}-${latestVisit?.createdAt || storedDraft?.createdAt || "new"}`}
        state={state}
        settings={settings}
        selectedDealership={selectedDealership}
        selectedCluster={selectedCluster}
        latestVisit={latestVisit}
        storedDraft={storedDraft}
        contact={contact}
        latestMedia={latestMedia}
        dispatch={dispatch}
      />
    </AppLayout>
  );
}
