import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "../components/AppLayout";
import { getDistanceMilesBetweenPoints } from "../lib/leadHelperModel";
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

const DUPLICATE_DISTANCE_MILES = 0.12;
const MAP_DETAILS_PHONE_PATTERN = /(?:\+44|0)(?:[\d\s().-]){8,}/;
const UK_POSTCODE_PATTERN = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
const ADDRESS_WORD_PATTERN = /\b(?:road|rd|street|st|lane|ln|avenue|ave|drive|dr|way|mews|place|pl|park|high street|devonshire)\b/i;

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

function formatMiles(value) {
  if (!Number.isFinite(value)) return "";
  if (value < 0.1) return `${Math.round(value * 5280)} ft`;
  return `${value.toFixed(2)} mi`;
}

function sanitizeWebsite(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "");
}

function sanitizePhone(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function findNearestPin(location, pins = []) {
  if (!Array.isArray(location)) return null;
  return pins
    .filter((pin) => Array.isArray(pin.location))
    .map((pin) => ({
      ...pin,
      distanceMiles: getDistanceMilesBetweenPoints(location, pin.location),
    }))
    .sort((left, right) => left.distanceMiles - right.distanceMiles || left.name.localeCompare(right.name))[0] || null;
}

function parseMapsDetails(rawText) {
  const lines = String(rawText || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const text = lines.join("\n");
  const phoneMatch = text.match(MAP_DETAILS_PHONE_PATTERN);
  const urlMatch = text.match(/https?:\/\/[^\s]+|(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s,]*/i);
  const addressLine =
    lines.find((line) => UK_POSTCODE_PATTERN.test(line)) ||
    lines.find((line) => /London/i.test(line) && ADDRESS_WORD_PATTERN.test(line)) ||
    lines.find((line) => ADDRESS_WORD_PATTERN.test(line));
  const ignoredLinePattern = /^(directions|save|nearby|send to phone|share|call|website|route|open|closed|hours|photos|reviews?)$/i;
  const nameLine = lines.find((line) => {
    if (ignoredLinePattern.test(line)) return false;
    if (line === addressLine) return false;
    if (phoneMatch && line.includes(phoneMatch[0])) return false;
    if (urlMatch && line.includes(urlMatch[0])) return false;
    if (UK_POSTCODE_PATTERN.test(line)) return false;
    if (/^\d+(\.\d+)?\s*★/.test(line)) return false;
    return /[a-z]/i.test(line);
  });

  return {
    name: nameLine || "",
    address: addressLine || "",
    phone: phoneMatch ? sanitizePhone(phoneMatch[0]) : "",
    website: urlMatch ? sanitizeWebsite(urlMatch[0]) : "",
  };
}

export function LocationPage() {
  const { selectedDealership, mapV2, dispatch } = useAppState();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Add a dealership first, then capture contact details on the Leads page.");
  const [error, setError] = useState("");
  const [mapDetailsText, setMapDetailsText] = useState("");
  const [userLocation, setUserLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState("Use your phone location to check for an existing nearby map pin.");
  const [selectedPinId, setSelectedPinId] = useState("");
  const nameInputRef = useRef(null);
  const addressInputRef = useRef(null);
  const websiteInputRef = useRef(null);
  const phoneInputRef = useRef(null);
  const roleInputRef = useRef(null);
  const hintInputRef = useRef(null);
  const [form, setForm] = useState(() => emptyLocationForm());
  const selectedPin = useMemo(() => mapV2.pins.find((pin) => pin.id === selectedPinId) || null, [mapV2.pins, selectedPinId]);
  const nearestUserPin = useMemo(() => findNearestPin(userLocation, mapV2.pins), [mapV2.pins, userLocation]);

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

  function applyFormPatch(patch) {
    setForm((current) => ({
      ...current,
      ...Object.fromEntries(Object.entries(patch).filter(([, value]) => String(value || "").trim())),
    }));
  }

  function applyMapsDetails(text) {
    const parsed = parseMapsDetails(text);
    const hasUsefulFields = Object.values(parsed).some(Boolean);
    if (!hasUsefulFields) {
      setError("I could not find a dealership name, address, phone, or website in that pasted text.");
      return;
    }
    setError("");
    applyFormPatch(parsed);
    setStatus("Google Maps details extracted. Check the fields, then add or update the map pin.");
  }

  async function pasteMapsDetailsFromClipboard() {
    if (!navigator.clipboard?.readText) {
      setError("Clipboard access is not available in this browser. Paste the Maps text into the box instead.");
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      setMapDetailsText(text);
      applyMapsDetails(text);
    } catch {
      setError("Clipboard permission was blocked. Paste the Maps text into the box instead.");
    }
  }

  function selectExistingPin(pin) {
    if (!pin) return;
    setSelectedPinId(pin.id);
    setError("");
    setStatus(`Ready to update existing map pin: ${pin.name}`);
    setForm({
      name: pin.name || "",
      address: pin.address || "",
      website: pin.website || "",
      phone: pin.phone || "",
      roleHint: form.roleHint,
      contactHint: form.contactHint,
    });
  }

  function requestCurrentLocation() {
    if (!("geolocation" in navigator)) {
      setLocationStatus("Location is not available on this device.");
      return;
    }
    setLocationStatus("Checking your current position");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLocation = [position.coords.latitude, position.coords.longitude];
        const nearest = findNearestPin(nextLocation, mapV2.pins);
        setUserLocation(nextLocation);
        setLocationStatus(
          nearest
            ? `Nearest existing pin: ${nearest.name}, ${formatMiles(nearest.distanceMiles)} away.`
            : "Location found. No dealership pins are close enough to flag.",
        );
      },
      () => {
        setLocationStatus("Location permission was blocked or unavailable.");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
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
      const resolvedLocation = [bestMatch.lat, bestMatch.lng];
      const nearestResolvedPin = findNearestPin(resolvedLocation, mapV2.pins);
      const pinToUpdate =
        selectedPin ||
        (nearestResolvedPin && nearestResolvedPin.distanceMiles <= DUPLICATE_DISTANCE_MILES ? nearestResolvedPin : null);
      const manualDealershipId = pinToUpdate?.legacyDealershipId || createManualDealershipId(name, address);
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
          location: resolvedLocation,
          geocodeLabel: bestMatch.displayName,
          intelDistance: "Manual add",
          nextAction: "Capture contact and log visit outcomes",
        },
      });
      dispatch({
        type: "upsert-map-v2-pin",
        payload: {
          pinId: pinToUpdate?.id,
          legacyDealershipId: manualDealershipId,
          name,
          address,
          website,
          phone,
          location: resolvedLocation,
          sourceRef: "add-location",
        },
      });
      setStatus(
        pinToUpdate
          ? `Updated existing map pin: ${pinToUpdate.name} -> ${name}.`
          : `Pinned to Map as an unassigned location from: ${bestMatch.displayName}`,
      );
      setForm(emptyLocationForm());
      setMapDetailsText("");
      setSelectedPinId("");
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
            <button className="btn" type="button" onClick={requestCurrentLocation}>
              Check nearby pins
            </button>
          </div>

          <div className="location-import-box">
            <div className="section-head compact">
              <div>
                <div className="kicker">Fast import</div>
                <h3>Paste Google Maps details</h3>
              </div>
              <button className="btn" type="button" onClick={pasteMapsDetailsFromClipboard}>
                Paste clipboard
              </button>
            </div>
            <textarea
              className="input small-draft"
              value={mapDetailsText}
              onChange={(event) => setMapDetailsText(event.target.value)}
              placeholder="Paste a Google Maps listing, address block, website, or phone details here."
            />
            <div className="action-row">
              <button className="btn" type="button" onClick={() => applyMapsDetails(mapDetailsText)}>
                Extract fields
              </button>
              <small className="muted">Copy one listing from Maps, paste once, then check the filled fields below.</small>
            </div>
          </div>

          <div className="nearby-pin-card">
            <div>
              <b>Duplicate check</b>
              <small>{locationStatus}</small>
            </div>
            {nearestUserPin && nearestUserPin.distanceMiles <= DUPLICATE_DISTANCE_MILES ? (
              <button className="btn" type="button" onClick={() => selectExistingPin(nearestUserPin)}>
                Update this pin
              </button>
            ) : null}
          </div>

          {selectedPin ? (
            <div className="inline-alert">
              Updating existing map pin: <b>{selectedPin.name}</b>. The saved pin will use the edited name and address below.
            </div>
          ) : null}

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
