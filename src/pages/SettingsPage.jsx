import { useState } from "react";
import { AppLayout } from "../components/AppLayout";
import { useAppState } from "../state/AppState";
import { STORAGE_KEY } from "../lib/leadHelperModel";

export function SettingsPage() {
  const { dispatch, settings } = useAppState();
  const [openRouterApiKey, setOpenRouterApiKey] = useState(settings?.openRouterApiKey || "");
  const [ocrModel, setOcrModel] = useState(settings?.ocrModel || "qwen/qwen-vl-plus");
  const [emailModel, setEmailModel] = useState(settings?.emailModel || "openai/gpt-5-mini");
  const [emailGenerationMode, setEmailGenerationMode] = useState(settings?.emailGenerationMode || "template");
  const [workEmail, setWorkEmail] = useState(settings?.workEmail || "");
  const [preferredSendMode, setPreferredSendMode] = useState(settings?.preferredSendMode || "mailto");
  const [notificationsEnabled, setNotificationsEnabled] = useState(Boolean(settings?.notificationsEnabled));
  const [notificationLeadMinutes, setNotificationLeadMinutes] = useState(String(settings?.notificationLeadMinutes || 30));
  const [notificationPermission, setNotificationPermission] = useState(
    typeof window !== "undefined" && "Notification" in window ? window.Notification.permission : "unsupported",
  );
  const [saveState, setSaveState] = useState("Unsaved");

  function saveAll() {
    dispatch({
      type: "save-settings",
      payload: {
        openRouterApiKey,
        ocrModel,
        ocrProvider: "openrouter",
        emailProvider: "openrouter",
        emailModel,
        emailGenerationMode,
        workEmail,
        preferredSendMode,
        notificationsEnabled,
        notificationLeadMinutes: Math.max(1, Number(notificationLeadMinutes || 30)),
      },
    });
    setSaveState("Saved locally");
  }

  function exportBackup() {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const blob = new Blob([raw || "{}"], { type: "application/json" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `lead-helper-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    window.URL.revokeObjectURL(url);
  }

  async function requestNotificationPermission() {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }
    const result = await window.Notification.requestPermission();
    setNotificationPermission(result);
    if (result === "granted") {
      setNotificationsEnabled(true);
      setSaveState("Unsaved");
    }
  }

  return (
    <AppLayout statusLine="Field preferences synced locally">
      <section className="title-row">
        <div>
          <div className="kicker">Settings</div>
          <h1>Defaults for fast visits, clean admin, and defensible reports.</h1>
        </div>
        <button className="btn primary" type="button" onClick={saveAll}>
          Save all
        </button>
      </section>

      <section className="grid three settings-overview">
        <article className="panel metric">
          <strong>SW / W</strong>
          <span>Active London territory</span>
        </article>
        <article className="panel metric">
          <strong>4 hrs</strong>
          <span>Follow-up SLA after warm visit</span>
        </article>
        <article className="panel metric">
          <strong>{openRouterApiKey ? "Live" : "Manual"}</strong>
          <span>LLM features currently configured</span>
        </article>
      </section>

      <section className="grid two settings-grid">
        <article className="panel pad settings-card">
          <div className="section-head">
            <div>
              <div className="kicker">Capture automation</div>
              <h2>Turn visit notes into usable follow-up.</h2>
            </div>
            <span className="pill active">{saveState}</span>
          </div>
          <div className="draft settings-preview">
            When a visit is marked "Interested", Lead Helper creates:
            {"\n"}- a visit record
            {"\n"}- a dashboard action
            {"\n"}- a short dealer-specific email draft
            {"\n"}- a report-card evidence line
          </div>
          <div className="action-row">
            <button className="btn" type="button">
              Sync now
            </button>
            <button className="btn" type="button" onClick={exportBackup}>
              Export backup
            </button>
            <button className="btn" type="button" onClick={() => dispatch({ type: "reset-demo" })}>
              Reset demo data
            </button>
          </div>
        </article>

        <article className="panel pad settings-card">
          <div className="section-head">
            <div>
              <div className="kicker">OCR provider</div>
              <h2>OpenRouter + Qwen vision</h2>
            </div>
            <span className={`pill${openRouterApiKey ? " active" : ""}`}>{openRouterApiKey ? "Key present" : "Key needed"}</span>
          </div>

          <div className="field">
            <label>OpenRouter API key</label>
            <input
              className="text-input"
              type="password"
              value={openRouterApiKey}
              onChange={(event) => {
                setOpenRouterApiKey(event.target.value);
                setSaveState("Unsaved");
              }}
              placeholder="sk-or-v1-..."
            />
          </div>

          <div className="field">
            <label>OCR model slug</label>
            <input
              className="text-input"
              value={ocrModel}
              onChange={(event) => {
                setOcrModel(event.target.value);
                setSaveState("Unsaved");
              }}
              placeholder="qwen/qwen-vl-plus"
            />
          </div>

          <div className="draft settings-preview">
            Recommended default for this build:
            {"\n"}- provider: OpenRouter
            {"\n"}- model: qwen/qwen-vl-plus
            {"\n"}- workflow: capture image in Leads, run OCR, then verify fields before saving
          </div>

          <div className="action-row">
            <button className="btn primary" type="button" onClick={saveAll}>
              Save OCR settings
            </button>
          </div>
        </article>

        <article className="panel pad settings-card">
          <div className="section-head">
            <div>
              <div className="kicker">Email engine</div>
              <h2>Template-first, with optional OpenRouter polish</h2>
            </div>
            <span className={`pill${openRouterApiKey ? " active" : ""}`}>{openRouterApiKey ? "Ready" : "Template only"}</span>
          </div>

          <div className="field">
            <label>Default email mode</label>
            <div className="segmented three-way">
              {[
                { value: "template", label: "Template" },
                { value: "polish", label: "Polish" },
                { value: "generate", label: "Generate" },
              ].map((option) => (
                <button
                  key={option.value}
                  className={emailGenerationMode === option.value ? "active" : ""}
                  type="button"
                  onClick={() => {
                    setEmailGenerationMode(option.value);
                    setSaveState("Unsaved");
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>Email model slug</label>
            <input
              className="text-input"
              value={emailModel}
              onChange={(event) => {
                setEmailModel(event.target.value);
                setSaveState("Unsaved");
              }}
              placeholder="openai/gpt-5-mini"
            />
          </div>

          <div className="draft settings-preview">
            Recommended default for this build:
            {"\n"}- template mode for reliable mobile use
            {"\n"}- polish mode when the facts are already good and you just want a cleaner email
            {"\n"}- generate mode when OCR or visit context gives enough detail to write from scratch
          </div>

          <div className="field">
            <label>Work email / send-to-self inbox</label>
            <input
              className="text-input"
              value={workEmail}
              onChange={(event) => {
                setWorkEmail(event.target.value);
                setSaveState("Unsaved");
              }}
              placeholder="you@company.co.uk"
            />
          </div>

          <div className="field">
            <label>Preferred send handoff</label>
            <div className="segmented three-way">
              {[
                { value: "mailto", label: "Mail app" },
                { value: "outlook", label: "Outlook web" },
                { value: "self", label: "Send to self" },
              ].map((option) => (
                <button
                  key={option.value}
                  className={preferredSendMode === option.value ? "active" : ""}
                  type="button"
                  onClick={() => {
                    setPreferredSendMode(option.value);
                    setSaveState("Unsaved");
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="action-row">
            <button className="btn primary" type="button" onClick={saveAll}>
              Save email settings
            </button>
          </div>
        </article>

        <article className="panel pad settings-card">
          <div className="section-head">
            <div>
              <div className="kicker">Reminder engine</div>
              <h2>Browser nudges for due calls, emails, and site walks</h2>
            </div>
            <span className={`pill${notificationsEnabled ? " active" : ""}`}>
              {notificationPermission === "granted" ? "Enabled" : notificationPermission}
            </span>
          </div>

          <div className="field">
            <label>Reminder lead time (minutes)</label>
            <input
              className="text-input"
              type="number"
              min="1"
              step="1"
              value={notificationLeadMinutes}
              onChange={(event) => {
                setNotificationLeadMinutes(event.target.value);
                setSaveState("Unsaved");
              }}
            />
          </div>

          <div className="field">
            <label>Browser notifications</label>
            <div className="segmented three-way">
              {[
                { value: "on", label: "Enabled" },
                { value: "off", label: "Disabled" },
              ].map((option) => (
                <button
                  key={option.value}
                  className={(notificationsEnabled ? "on" : "off") === option.value ? "active" : ""}
                  type="button"
                  onClick={() => {
                    setNotificationsEnabled(option.value === "on");
                    setSaveState("Unsaved");
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="draft settings-preview">
            Permission state: {notificationPermission}
            {"\n"}- notifications fire when a pending action falls inside your lead-time window
            {"\n"}- this works best when the app is open on your phone or desktop
          </div>

          <div className="action-row">
            <button className="btn" type="button" onClick={requestNotificationPermission}>
              Request permission
            </button>
            <button className="btn primary" type="button" onClick={saveAll}>
              Save reminder settings
            </button>
          </div>
        </article>
      </section>
    </AppLayout>
  );
}
