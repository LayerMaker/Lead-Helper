import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "../components/AppLayout";
import { buildAdminEntries, getDistanceMilesBetweenPoints, visitOutcomeOptions } from "../lib/leadHelperModel";
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

function formFromDealership(dealership) {
  return {
    name: dealership?.name || "",
    address: dealership?.address || "",
    website: dealership?.website || "",
    phone: dealership?.phone || "",
    roleHint: dealership?.roleHint || "",
    contactHint: dealership?.contactHint || "",
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
  const { selectedDealership, mapV2, getLatestVisit, dispatch } = useAppState();
  const latestVisit = getLatestVisit(selectedDealership.id);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Add a dealership first, then capture contact details on the Leads page.");
  const [error, setError] = useState("");
  const [mapDetailsText, setMapDetailsText] = useState("");
  const [userLocation, setUserLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState("Use your phone location to check for an existing nearby map pin.");
  const [selectedPinId, setSelectedPinId] = useState("");
  const [targetClusterId, setTargetClusterId] = useState(mapV2.clusters[0]?.id || "");
  const [useCurrentLocationForPin, setUseCurrentLocationForPin] = useState(false);
  const [newLocationMode, setNewLocationMode] = useState(false);
  const nameInputRef = useRef(null);
  const addressInputRef = useRef(null);
  const websiteInputRef = useRef(null);
  const phoneInputRef = useRef(null);
  const roleInputRef = useRef(null);
  const hintInputRef = useRef(null);
  const formSyncKeyRef = useRef("");
  const [form, setForm] = useState(() => formFromDealership(selectedDealership));
  const [selectedVisitOutcomes, setSelectedVisitOutcomes] = useState(() => latestVisit?.outcomes || []);
  const [visitNote, setVisitNote] = useState(latestVisit?.note || "");
  const [visitSaveStatus, setVisitSaveStatus] = useState(latestVisit ? "Latest visit loaded" : "No visit saved yet");
  const selectedPin = useMemo(() => mapV2.pins.find((pin) => pin.id === selectedPinId) || null, [mapV2.pins, selectedPinId]);
  const targetCluster = useMemo(
    () => mapV2.clusters.find((cluster) => cluster.id === targetClusterId) || mapV2.clusters[0] || null,
    [mapV2.clusters, targetClusterId],
  );
  const nearestUserPin = useMemo(() => findNearestPin(userLocation, mapV2.pins), [mapV2.pins, userLocation]);
  const visitAdminEntries = useMemo(() => buildAdminEntries(selectedVisitOutcomes), [selectedVisitOutcomes]);

  useEffect(() => {
    if (newLocationMode) return;
    const syncKey = `${selectedDealership.id}:${latestVisit?.id || ""}`;
    if (formSyncKeyRef.current === syncKey) return;
    formSyncKeyRef.current = syncKey;
    setForm(formFromDealership(selectedDealership));
    const activePin = mapV2.pins.find(
      (pin) => pin.legacyDealershipId === selectedDealership.id || pin.dealershipId === selectedDealership.id,
    );
    setSelectedPinId(activePin?.id || "");
    setSelectedVisitOutcomes(latestVisit?.outcomes || []);
    setVisitNote(latestVisit?.note || "");
    setVisitSaveStatus(latestVisit ? "Latest visit loaded" : "No visit saved yet");
    setStatus(`Loaded active map pin: ${selectedDealership.name}. Edit fields, then save to update the working record.`);
  }, [latestVisit, mapV2.pins, newLocationMode, selectedDealership]);

  function updateField(key, value) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function loadAutoWestTestLead() {
    setNewLocationMode(true);
    formSyncKeyRef.current = "new-location";
    setSelectedPinId("");
    setSelectedVisitOutcomes([]);
    setVisitNote("");
    setVisitSaveStatus("New location draft");
    setError("");
    setStatus("Auto West test lead loaded. Add it to the map or edit the fields first.");
    setForm({
      ...AUTO_WEST_TEST_LEAD,
    });
  }

  function startNewLocation() {
    setNewLocationMode(true);
    formSyncKeyRef.current = "new-location";
    setForm(emptyLocationForm());
    setSelectedPinId("");
    setSelectedVisitOutcomes([]);
    setVisitNote("");
    setVisitSaveStatus("New location draft");
    setMapDetailsText("");
    setUseCurrentLocationForPin(false);
    setUserLocation(null);
    setLocationStatus("Use your phone location, paste Maps details, or type the address manually.");
    setError("");
    setStatus("New map pin draft started. Fill the fields, then choose Add to map or Add to cluster.");
    nameInputRef.current?.focus();
  }

  function loadActiveDealership() {
    setNewLocationMode(false);
    formSyncKeyRef.current = "";
    setForm(formFromDealership(selectedDealership));
    const activePin = mapV2.pins.find(
      (pin) => pin.legacyDealershipId === selectedDealership.id || pin.dealershipId === selectedDealership.id,
    );
    setSelectedPinId(activePin?.id || "");
    setSelectedVisitOutcomes(latestVisit?.outcomes || []);
    setVisitNote(latestVisit?.note || "");
    setVisitSaveStatus(latestVisit ? "Latest visit loaded" : "No visit saved yet");
    setError("");
    setStatus(`Loaded active dealership: ${selectedDealership.name}`);
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
    setNewLocationMode(false);
    formSyncKeyRef.current = "";
    setSelectedPinId(pin.id);
    if (pin.legacyDealershipId || pin.dealershipId) {
      dispatch({ type: "select-dealership", dealershipId: pin.legacyDealershipId || pin.dealershipId });
    }
    setError("");
    setStatus(`Ready to update existing map pin: ${pin.name}`);
    setForm({
      name: pin.name || "",
      address: pin.address || "",
      website: pin.website || "",
      phone: pin.phone || "",
      roleHint: form.roleHint || selectedDealership.roleHint || "",
      contactHint: form.contactHint || selectedDealership.contactHint || "",
    });
  }

  function requestCurrentLocation(useForPin = false) {
    if (!("geolocation" in navigator)) {
      setLocationStatus("Location is not available on this device.");
      return;
    }
    setLocationStatus(useForPin ? "Getting your current position for the new pin" : "Checking your current position");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLocation = [position.coords.latitude, position.coords.longitude];
        const nearest = findNearestPin(nextLocation, mapV2.pins);
        setUserLocation(nextLocation);
        if (useForPin) setUseCurrentLocationForPin(true);
        setLocationStatus(
          useForPin
            ? `Current position ready for the new pin. ${nearest ? `Nearest existing pin: ${nearest.name}, ${formatMiles(nearest.distanceMiles)} away.` : "No nearby pin found."}`
            : nearest
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

  function getLocationFormValues() {
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

    return { address, contactHint, name, phone, roleHint, website };
  }

  async function resolvePinLocation({ address }) {
    if (useCurrentLocationForPin && Array.isArray(userLocation)) {
      return {
        displayName: "Current GPS position",
        location: userLocation,
      };
    }

    if (!address) {
      throw new Error("Add a street address or use your current location for the pin.");
    }

    const [bestMatch] = await geocodeAddress(address);
    return {
      displayName: bestMatch.displayName,
      location: [bestMatch.lat, bestMatch.lng],
    };
  }

  async function saveLocation({ assignToCluster = false } = {}) {
    const { address, contactHint, name, phone, roleHint, website } = getLocationFormValues();

    if (!name) {
      setError("Dealership name is required.");
      return;
    }

    if (assignToCluster && !targetCluster) {
      setError("Choose a cluster before adding this pin to a cluster.");
      return;
    }

    setBusy(true);
    setError("");
    setStatus(useCurrentLocationForPin ? "Using current GPS position for the map pin" : "Resolving address against OpenStreetMap");

    try {
      const resolved = await resolvePinLocation({ address });
      const resolvedLocation = resolved.location;
      const nearestResolvedPin = findNearestPin(resolvedLocation, mapV2.pins);
      const pinToUpdate =
        selectedPin ||
        (!newLocationMode && nearestResolvedPin && nearestResolvedPin.distanceMiles <= DUPLICATE_DISTANCE_MILES ? nearestResolvedPin : null);
      const displayAddress = address || `${resolvedLocation[0].toFixed(6)}, ${resolvedLocation[1].toFixed(6)}`;
      const manualDealershipId = pinToUpdate?.legacyDealershipId || pinToUpdate?.dealershipId || createManualDealershipId(name, displayAddress);
      const nextPinId = pinToUpdate?.id || `pin-${manualDealershipId}`;
      dispatch({
        type: "add-location-to-map",
        clusterId: assignToCluster ? targetCluster.id : "",
        dealership: {
          id: manualDealershipId,
          clusterId: assignToCluster ? targetCluster.id : targetCluster?.id,
          name,
          address: displayAddress,
          website,
          phone,
          roleHint,
          contactHint,
          location: resolvedLocation,
          geocodeLabel: resolved.displayName,
          intelDistance: "Manual add",
          nextAction: "Capture contact and log visit outcomes",
        },
        pin: {
          pinId: nextPinId,
          legacyDealershipId: manualDealershipId,
          name,
          address: displayAddress,
          website,
          phone,
          location: resolvedLocation,
          sourceRef: "add-location",
        },
        options: {
          assignmentType: "manual",
          assignedBy: "user",
        },
      });
      setStatus(
        pinToUpdate
          ? `Updated existing map pin: ${pinToUpdate.name} -> ${name}.`
          : assignToCluster
            ? `Added ${name} to Map and ${targetCluster.name}. Pin ready on the map.`
            : `Added ${name} to Map as an unassigned location from: ${resolved.displayName}. Pin ready on the map.`,
      );
      setForm(emptyLocationForm());
      setMapDetailsText("");
      setSelectedPinId(nextPinId);
      setUseCurrentLocationForPin(false);
    } catch (addError) {
      setError(addError.message || "Address lookup failed.");
      setStatus("Location needs a valid map match before it can join the dealership database.");
    } finally {
      setBusy(false);
    }
  }

  function toggleVisitOutcome(outcome) {
    setSelectedVisitOutcomes((current) =>
      current.includes(outcome) ? current.filter((item) => item !== outcome) : [...current, outcome],
    );
    setVisitSaveStatus("Visit outcomes changed");
  }

  function saveVisitOutcomes() {
    if (!selectedVisitOutcomes.length) {
      setVisitSaveStatus("Select at least one outcome chip before saving.");
      return;
    }
    dispatch({
      type: "generate-visit",
      dealershipId: selectedDealership.id,
      outcomes: selectedVisitOutcomes,
      note: visitNote || "Logged from Location page",
    });
    setVisitSaveStatus("Visit saved and added to report evidence");
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
          <button className="btn primary" type="button" onClick={startNewLocation}>
            + New location
          </button>
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
            <button
              className="btn primary"
              type="button"
              onClick={loadActiveDealership}
            >
              Load active pin
            </button>
            <button className="btn" type="button" onClick={loadAutoWestTestLead}>
              Load Auto West test lead
            </button>
            <button className="btn" type="button" onClick={() => requestCurrentLocation(false)}>
              Check nearby pins
            </button>
            <button className="btn" type="button" onClick={() => requestCurrentLocation(true)}>
              Use my location
            </button>
          </div>

          {newLocationMode ? (
            <div className="inline-alert">
              New location mode is active. Loaded dealership fields have been cleared so this saves as a separate map pin.
            </div>
          ) : null}

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

          {useCurrentLocationForPin && Array.isArray(userLocation) ? (
            <div className="inline-alert">
              New map pin will use your current GPS position: <b>{userLocation[0].toFixed(6)}, {userLocation[1].toFixed(6)}</b>.
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
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Add to cluster</label>
              <select className="text-input" value={targetCluster?.id || ""} onChange={(event) => setTargetClusterId(event.target.value)}>
                {mapV2.clusters.map((cluster) => (
                  <option key={cluster.id} value={cluster.id}>
                    {cluster.name}
                  </option>
                ))}
              </select>
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
            <button className="btn primary" type="button" disabled={busy} onClick={() => saveLocation({ assignToCluster: false })}>
              {busy ? "Pinning location" : "Add to map"}
            </button>
            <button className="btn primary" type="button" disabled={busy || !targetCluster} onClick={() => saveLocation({ assignToCluster: true })}>
              {busy ? "Pinning location" : "Add to cluster"}
            </button>
          </div>
        </article>

        <aside className="panel pad">
          <div className="section-head">
            <div>
              <div className="kicker">Visit close-out</div>
              <h2>Log this selected pin</h2>
            </div>
            <span className={`pill${selectedVisitOutcomes.length ? " active" : ""}`}>{selectedVisitOutcomes.length || "No"} chips</span>
          </div>

          <div className="field">
            <label>Outcome chips</label>
            <div className="outcomes">
              {visitOutcomeOptions.map((outcome) => (
                <button
                  key={outcome}
                  className={`chip${selectedVisitOutcomes.includes(outcome) ? " selected" : ""}`}
                  type="button"
                  onClick={() => toggleVisitOutcome(outcome)}
                >
                  {outcome}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>Visit note</label>
            <textarea
              className="input"
              rows="4"
              value={visitNote}
              onChange={(event) => {
                setVisitNote(event.target.value);
                setVisitSaveStatus("Visit outcomes changed");
              }}
              placeholder="Example: shutters down, looks permanently closed, signage removed."
            />
          </div>

          <div className="inline-alert">
            {visitSaveStatus}. {visitAdminEntries.length} report/admin item{visitAdminEntries.length === 1 ? "" : "s"} ready.
          </div>

          <div className="action-row">
            <button className="btn primary" type="button" onClick={saveVisitOutcomes} disabled={!selectedVisitOutcomes.length}>
              Save visit evidence
            </button>
            <Link className="btn" to="/summary">
              Summary
            </Link>
            <Link className="btn" to="/reports">
              Reports
            </Link>
          </div>
        </aside>

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
