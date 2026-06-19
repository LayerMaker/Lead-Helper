import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "../components/AppLayout";
import { geocodeAddress } from "../lib/osmService";
import { useAppState } from "../state/AppState";

const AUTO_WEST_TEST_LEAD = {
  name: "Auto West London OMODA & JAECOO",
  address: "109 Devonshire Rd, Chiswick, London W4 2AN",
  website: "autowestlondon.co.uk",
  phone: "02039 317860",
  roleHint: "Showroom manager",
  contactHint: "Met on site, brochure already sent",
};

function emptyLocationForm() {
  return {
    name: "",
    address: "",
    website: "",
    phone: "",
    roleHint: "",
    contactHint: "",
  };
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createManualDealershipId(name, address) {
  return `manual-${slugify(name)}-${slugify(address).slice(0, 32)}`;
}

export function LocationPage() {
  const { selectedDealership, dispatch } = useAppState();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Add a dealership first, then capture contact details on the Leads page.");
  const [error, setError] = useState("");
  const nameInputRef = useRef(null);
  const addressInputRef = useRef(null);
  const websiteInputRef = useRef(null);
  const phoneInputRef = useRef(null);
  const roleInputRef = useRef(null);
  const hintInputRef = useRef(null);
  const [form, setForm] = useState(() => emptyLocationForm());

  function updateField(key, value) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function loadAutoWestTestLead() {
    setError("");
    setStatus("Auto West test lead loaded. Add it to the map or edit the fields first.");
    setForm({
      ...AUTO_WEST_TEST_LEAD,
    });
  }

  async function addLocation() {
    const name = String(nameInputRef.current?.value ?? form.name).trim();
    const address = String(addressInputRef.current?.value ?? form.address).trim();
    const website = String(websiteInputRef.current?.value ?? form.website).trim();
    const phone = String(phoneInputRef.current?.value ?? form.phone).trim();
    const roleHint = String(roleInputRef.current?.value ?? form.roleHint).trim();
    const contactHint = String(hintInputRef.current?.value ?? form.contactHint).trim();

    setForm({
      name,
      address,
      website,
      phone,
      roleHint,
      contactHint,
    });

    if (!name || !address) {
      setError("Dealership name and street address are required.");
      return;
    }

    setBusy(true);
    setError("");
    setStatus("Resolving address against OpenStreetMap");

    try {
      const [bestMatch] = await geocodeAddress(address);
      const manualDealershipId = createManualDealershipId(name, address);
      dispatch({
        type: "upsert-manual-dealership",
        payload: {
          id: manualDealershipId,
          name,
          address,
          website,
          phone,
          roleHint,
          contactHint,
          location: [bestMatch.lat, bestMatch.lng],
          geocodeLabel: bestMatch.displayName,
          intelDistance: "Manual add",
          nextAction: "Capture contact and log visit outcomes",
        },
      });
      dispatch({
        type: "upsert-map-v2-pin",
        payload: {
          legacyDealershipId: manualDealershipId,
          name,
          address,
          website,
          phone,
          location: [bestMatch.lat, bestMatch.lng],
          sourceRef: "add-location",
        },
      });
      setStatus(`Pinned to Map as an unassigned location from: ${bestMatch.displayName}`);
      setForm(emptyLocationForm());
    } catch (addError) {
      setError(addError.message || "Address lookup failed.");
      setStatus("Location needs a valid map match before it can join the dealership database.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppLayout statusLine="+ Location - add dealership pins before lead capture">
      <section className="title-row">
        <div>
          <div className="kicker">+ Location</div>
          <h1>Add a dealership to the map before working the lead.</h1>
          <p className="subtle-copy">
            This creates the place record and an unassigned map pin. Contact names and business cards belong on the Leads page after the location exists.
          </p>
        </div>
        <div className="action-row">
          <Link className="btn" to="/map">
            View map
          </Link>
          <Link className="btn primary" to="/leads">
            Open leads
          </Link>
        </div>
      </section>

      <section className="grid two">
        <article className="panel pad">
          <div className="section-head">
            <div>
              <div className="kicker">New dealership record</div>
              <h2>Pin a location</h2>
            </div>
            <span className="pill">Map first</span>
          </div>

          <div className="action-row" style={{ marginBottom: 12 }}>
            <button className="btn" type="button" onClick={loadAutoWestTestLead}>
              Load Auto West test lead
            </button>
          </div>

          <div className="grid two compact-form">
            <div className="field">
              <label>Dealership name</label>
              <input
                ref={nameInputRef}
                className="text-input"
                value={form.name}
                onChange={(event) => updateField("name", event.target.value)}
                placeholder="Type dealership name"
              />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Street address</label>
              <input
                ref={addressInputRef}
                className="text-input"
                value={form.address}
                onChange={(event) => updateField("address", event.target.value)}
                placeholder="Type full street address"
              />
            </div>
            <div className="field">
              <label>Website</label>
              <input
                ref={websiteInputRef}
                className="text-input"
                value={form.website}
                onChange={(event) => updateField("website", event.target.value)}
                placeholder="Optional website"
              />
            </div>
            <div className="field">
              <label>Phone</label>
              <input
                ref={phoneInputRef}
                className="text-input"
                value={form.phone}
                onChange={(event) => updateField("phone", event.target.value)}
                placeholder="Optional phone"
              />
            </div>
            <div className="field">
              <label>Who to ask for</label>
              <input
                ref={roleInputRef}
                className="text-input"
                value={form.roleHint}
                onChange={(event) => updateField("roleHint", event.target.value)}
                placeholder="Optional role hint"
              />
            </div>
            <div className="field">
              <label>Contact hint</label>
              <input
                ref={hintInputRef}
                className="text-input"
                value={form.contactHint}
                onChange={(event) => updateField("contactHint", event.target.value)}
                placeholder="Optional contact hint"
              />
            </div>
          </div>

          <div className="feed-forward">
            <span className={`flow-dot${busy ? " active" : ""}`}></span>
            <div>
              <b>Location status</b>
              <small>{status}</small>
            </div>
          </div>

          {error ? <div className="inline-alert error">{error}</div> : null}

          <div className="action-row">
            <button className="btn primary" type="button" disabled={busy} onClick={addLocation}>
              {busy ? "Pinning location" : "Add location to map"}
            </button>
          </div>
        </article>

        <aside className="panel table">
          <div className="row selected">
            <span className="number">01</span>
            <div>
              <h3>Current active dealership</h3>
              <small>{selectedDealership.name}. {selectedDealership.address}</small>
            </div>
            <span className={`pill${selectedDealership.isManual ? " active" : ""}`}>
              {selectedDealership.isManual ? "Manual pin" : "Scraped pin"}
            </span>
          </div>
          <div className="row">
            <span className="number">02</span>
            <div>
              <h3>Next step after adding</h3>
              <small>Open Leads to capture business cards, contact names, and dealership intel.</small>
            </div>
            <Link className="btn" to="/leads">
              Leads
            </Link>
          </div>
          <div className="row">
            <span className="number">03</span>
            <div>
              <h3>Map result</h3>
              <small>The new pin appears on the map as unassigned. Use lasso selection to add it to the right field cluster.</small>
            </div>
            <Link className="btn" to="/map">
              Map
            </Link>
          </div>
        </aside>
      </section>
    </AppLayout>
  );
}
