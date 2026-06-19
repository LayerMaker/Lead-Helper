import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { DiscoveryMap } from "../components/DiscoveryMap";
import { FieldMap } from "../components/FieldMap";
import {
  buildGoogleMapsRouteUrl,
  discoveryAreas,
  discoveryProspects,
  getCluster,
  getDiscoveryOverview,
  getDiscoveryProspectsForArea,
  getDistanceMilesBetweenPoints,
  getClusterCenter,
} from "../lib/leadHelperModel";
import { AppLayout } from "../components/AppLayout";
import { useAppState } from "../state/AppState";

function formatMiles(value) {
  if (!Number.isFinite(value)) return "";
  const rounded = value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  return `${rounded} mi`;
}

function formatClusterLabel(name) {
  return String(name || "").toLowerCase().includes("cluster") ? name : `${name} cluster`;
}

export function MapPage() {
  const {
    state,
    dealerships,
    unclusteredDealerships,
    clusters,
    selectedCluster,
    selectedDealership,
    dispatch,
    getDealershipsForCluster: getRuntimeDealershipsForCluster,
  } = useAppState();
  const [mapMode, setMapMode] = useState("discovery");
  const [selectedDiscoveryAreaId, setSelectedDiscoveryAreaId] = useState(discoveryAreas[0]?.id || null);
  const [selectedDiscoveryProspectId, setSelectedDiscoveryProspectId] = useState(null);
  const [selectedManualDealershipId, setSelectedManualDealershipId] = useState(null);
  const [manualAssignClusterId, setManualAssignClusterId] = useState("");
  const [manualClusterName, setManualClusterName] = useState("");
  const [clusterDrafts, setClusterDrafts] = useState({});
  const [userLocation, setUserLocation] = useState(null);
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [locationStatus, setLocationStatus] = useState("Location off");
  const watchIdRef = useRef(null);
  const selectedDealers = getRuntimeDealershipsForCluster(selectedCluster.id);
  const manualDealerships = useMemo(
    () => dealerships.filter((dealership) => dealership.isManual || dealership.sourceType === "manual"),
    [dealerships],
  );
  const selectedManualDealership = useMemo(
    () =>
      manualDealerships.find((dealership) => dealership.id === selectedManualDealershipId) ||
      unclusteredDealerships[0] ||
      manualDealerships[0] ||
      null,
    [manualDealerships, selectedManualDealershipId, unclusteredDealerships],
  );
  const warmCount = selectedDealers.filter((dealer) => dealer.status === "Interested" || dealer.status === "Site walk booked").length;
  const mapsRouteUrl = buildGoogleMapsRouteUrl(state, selectedCluster.id);
  const discoveryOverview = useMemo(() => getDiscoveryOverview(), []);
  const selectedDiscoveryArea = useMemo(
    () => discoveryAreas.find((area) => area.id === selectedDiscoveryAreaId) || discoveryAreas[0] || null,
    [selectedDiscoveryAreaId],
  );
  const selectedDiscoveryProspects = useMemo(
    () => getDiscoveryProspectsForArea(selectedDiscoveryArea?.id),
    [selectedDiscoveryArea],
  );
  const selectedDiscoveryProspect = useMemo(
    () => selectedDiscoveryProspects.find((prospect) => prospect.id === selectedDiscoveryProspectId) || selectedDiscoveryProspects[0] || null,
    [selectedDiscoveryProspectId, selectedDiscoveryProspects],
  );
  const allOperationalDealers = useMemo(
    () => dealerships.filter((dealer) => Array.isArray(dealer.location)),
    [dealerships],
  );
  const nearestManualCluster = useMemo(() => {
    if (!selectedManualDealership?.location) return null;

    return clusters
      .map((cluster) => {
        const center = getClusterCenter(state, cluster.id);
        return {
          ...cluster,
          distanceMiles: getDistanceMilesBetweenPoints(selectedManualDealership.location, center),
        };
      })
      .filter((cluster) => Number.isFinite(cluster.distanceMiles))
      .sort((left, right) => left.distanceMiles - right.distanceMiles)[0] || null;
  }, [clusters, selectedManualDealership, state]);
  const effectiveManualAssignClusterId = manualAssignClusterId || selectedManualDealership?.clusterId || nearestManualCluster?.id || selectedCluster.id;
  const effectiveManualClusterName =
    manualClusterName || (selectedManualDealership ? `${selectedManualDealership.shortName || selectedManualDealership.name} field cluster` : "");
  const nearestDiscoveryProspect = useMemo(() => {
    if (!userLocation) return null;

    return discoveryProspects
      .map((prospect) => ({
        ...prospect,
        distanceMiles: getDistanceMilesBetweenPoints(userLocation, prospect.location),
      }))
      .sort((left, right) => left.distanceMiles - right.distanceMiles)[0] || null;
  }, [userLocation]);
  const nearestOperationalDealer = useMemo(() => {
    if (!userLocation) return null;

    return allOperationalDealers
      .map((dealer) => ({
        ...dealer,
        distanceMiles: getDistanceMilesBetweenPoints(userLocation, dealer.location),
      }))
      .sort((left, right) => left.distanceMiles - right.distanceMiles)[0] || null;
  }, [allOperationalDealers, userLocation]);
  const locationTarget = mapMode === "discovery" ? nearestDiscoveryProspect : nearestOperationalDealer;
  const locationTargetAreaId = useMemo(
    () => (nearestDiscoveryProspect ? discoveryAreas.find((area) => area.name === nearestDiscoveryProspect.searchOrigin)?.id || null : null),
    [nearestDiscoveryProspect],
  );
  const promotedCluster = useMemo(
    () => clusters.find((cluster) => cluster.sourceAreaId === selectedDiscoveryArea?.id) || null,
    [clusters, selectedDiscoveryArea],
  );
  const parkedAreaIds = useMemo(() => state.parkedDiscoveryAreaIds || [], [state.parkedDiscoveryAreaIds]);
  const promotedAreaIds = useMemo(
    () => clusters.map((cluster) => cluster.sourceAreaId).filter(Boolean),
    [clusters],
  );
  const activeDiscoveryAreas = useMemo(
    () => discoveryAreas.filter((area) => !parkedAreaIds.includes(area.id) && !promotedAreaIds.includes(area.id)),
    [parkedAreaIds, promotedAreaIds],
  );
  const promotedDiscoveryAreas = useMemo(
    () => discoveryAreas.filter((area) => promotedAreaIds.includes(area.id)),
    [promotedAreaIds],
  );
  const parkedDiscoveryAreas = useMemo(
    () => discoveryAreas.filter((area) => parkedAreaIds.includes(area.id) && !promotedAreaIds.includes(area.id)),
    [parkedAreaIds, promotedAreaIds],
  );
  const selectedDiscoveryAreaStatus = promotedCluster ? "promoted" : parkedAreaIds.includes(selectedDiscoveryArea?.id) ? "parked" : "candidate";
  const clusterDraftName =
    clusterDrafts[selectedDiscoveryArea?.id] || promotedCluster?.name || (selectedDiscoveryArea ? `${selectedDiscoveryArea.name} field cluster` : "");
  const arrivalState = locationTarget
    ? locationTarget.distanceMiles <= 0.05
      ? "On site"
      : locationTarget.distanceMiles <= 0.25
        ? "Nearby"
        : "In area"
    : null;

  useEffect(() => () => {
    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
  }, []);

  function startLocationTracking() {
    if (!("geolocation" in navigator)) {
      setLocationStatus("Geolocation unavailable on this device");
      return;
    }
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }

    setLocationStatus("Requesting live location");
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setUserLocation([position.coords.latitude, position.coords.longitude]);
        setLocationEnabled(true);
        setLocationStatus(position.coords.accuracy ? `Live to ~${Math.round(position.coords.accuracy)} m` : "Live location on");
      },
      (error) => {
        setLocationEnabled(false);
        if (error.code === error.PERMISSION_DENIED) {
          setLocationStatus("Location permission denied");
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          setLocationStatus("Location unavailable");
        } else if (error.code === error.TIMEOUT) {
          setLocationStatus("Location request timed out");
        } else {
          setLocationStatus("Location failed");
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 15000,
        timeout: 12000,
      },
    );
  }

  function stopLocationTracking() {
    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setLocationEnabled(false);
    setUserLocation(null);
    setLocationStatus("Location off");
  }

  function selectManualDealership(dealershipId) {
    const dealership = manualDealerships.find((item) => item.id === dealershipId);
    setSelectedManualDealershipId(dealershipId);
    setManualAssignClusterId(dealership?.clusterId || nearestManualCluster?.id || selectedCluster.id);
    setManualClusterName(dealership ? `${dealership.shortName || dealership.name} field cluster` : "");
    dispatch({ type: "select-dealership", dealershipId });
  }

  function assignManualDealershipToCluster(clusterId = effectiveManualAssignClusterId) {
    if (!selectedManualDealership || !clusterId) return;
    dispatch({
      type: "assign-dealership-cluster",
      dealershipId: selectedManualDealership.id,
      clusterId,
    });
    setMapMode("operational");
  }

  function createManualCluster() {
    if (!selectedManualDealership) return;
    dispatch({
      type: "create-manual-cluster",
      dealershipIds: [selectedManualDealership.id],
      name: effectiveManualClusterName,
    });
    setMapMode("operational");
  }

  return (
    <AppLayout statusLine={mapMode === "discovery" ? "Discovery coverage for new-car showroom prospects" : "Southwest and west London operational clusters"}>
      <section className="title-row">
        <div>
          <div className="kicker">{mapMode === "discovery" ? "Discovery map" : "Operational map"}</div>
          <h1>
            {mapMode === "discovery"
              ? "Review the dealership pin field before turning anything into a working route."
              : "Pick the physical territory before starting the dealership route."}
          </h1>
        </div>
        <div className="action-row">
          <div className="segmented">
            <button className={mapMode === "discovery" ? "active" : ""} type="button" onClick={() => setMapMode("discovery")}>
              Discovery
            </button>
            <button className={mapMode === "operational" ? "active" : ""} type="button" onClick={() => setMapMode("operational")}>
              Operational
            </button>
          </div>
          <button className={`btn${locationEnabled ? " primary" : ""}`} type="button" onClick={locationEnabled ? stopLocationTracking : startLocationTracking}>
            {locationEnabled ? "Stop live location" : "Use my location"}
          </button>
          {mapMode === "operational" ? (
            <>
              <a className="btn" href={mapsRouteUrl} target="_blank" rel="noreferrer">
                Open in Google Maps
              </a>
              <Link className="btn primary" to="/route">
                Start {formatClusterLabel(selectedCluster.name)} route
              </Link>
            </>
          ) : null}
        </div>
      </section>

      <section className="map-shell">
        <div className="panel map live-map-panel">
          {mapMode === "discovery" ? (
            <DiscoveryMap
              areas={discoveryAreas}
              prospects={discoveryProspects}
              selectedArea={selectedDiscoveryArea}
              selectedProspects={selectedDiscoveryProspects}
              selectedProspectId={selectedDiscoveryProspect?.id || null}
              onSelectArea={setSelectedDiscoveryAreaId}
              onSelectProspect={setSelectedDiscoveryProspectId}
              manualDealerships={manualDealerships}
              selectedManualDealershipId={selectedManualDealership?.id || null}
              onSelectManualDealership={selectManualDealership}
              userLocation={userLocation}
              parkedAreaIds={parkedAreaIds}
              promotedAreaIds={promotedAreaIds}
            />
          ) : (
            <FieldMap
              state={state}
              clusters={clusters}
              selectedCluster={selectedCluster}
              selectedDealershipId={selectedDealership.id}
              selectedDealers={selectedDealers}
              allDealers={dealerships}
              onSelectCluster={(clusterId) => dispatch({ type: "select-cluster", clusterId })}
              onSelectDealership={(dealershipId) => dispatch({ type: "select-dealership", dealershipId })}
              userLocation={userLocation}
            />
          )}
        </div>

        <aside className="panel pad cluster-drawer">
          <div className="intel-card location-card">
            <span className={`radar-dot${locationEnabled ? " live" : ""}`}></span>
            <div>
              <h3>{locationEnabled ? "Live location enabled" : "Live location off"}</h3>
              <small>{locationStatus}</small>
            </div>
            <span className={`pill${locationEnabled ? " active" : ""}`}>{locationEnabled ? "Tracking" : "Idle"}</span>
          </div>

          {mapMode === "discovery" ? (
            <>
              <div className="section-head">
                <div>
                  <div className="kicker">Selected search area</div>
                  <h2>{selectedDiscoveryArea?.name || "Discovery"}</h2>
                </div>
                <span className="pill active">OSM new-car profile</span>
              </div>
              <p>
                This is the planning surface: a wide discovery layer of showroom prospects, grouped by search area so we can see density before promoting anything into fieldwork clusters.
              </p>
              <div className="grid three stat-strip">
                <div className="metric panel">
                  <strong>{discoveryOverview.totalProspects}</strong>
                  <span>qualified pins</span>
                </div>
                <div className="metric panel">
                  <strong>{activeDiscoveryAreas.length}</strong>
                  <span>candidate areas</span>
                </div>
                <div className="metric panel">
                  <strong>{promotedDiscoveryAreas.length}</strong>
                  <span>field clusters</span>
                </div>
              </div>
              <div className="grid three stat-strip">
                <div className="metric panel">
                  <strong>{parkedDiscoveryAreas.length}</strong>
                  <span>parked areas</span>
                </div>
                <div className="metric panel">
                  <strong>{selectedDiscoveryArea?.count || 0}</strong>
                  <span>pins in selection</span>
                </div>
                <div className="metric panel">
                  <strong>{selectedDiscoveryArea?.averageFitScore || discoveryOverview.averageFitScore}</strong>
                  <span>selection fit score</span>
                </div>
              </div>
              <div className="intel-card">
                <span className="radar-dot"></span>
                <div>
                  <h3>Top brands in discovery</h3>
                  <small>{discoveryOverview.topBrands.join(", ")}</small>
                </div>
              </div>
              <div className="prospect-summary">
                <div className="section-head">
                  <div>
                    <div className="kicker">Manual pin inbox</div>
                    <h3>{selectedManualDealership ? selectedManualDealership.name : "No manual pins yet"}</h3>
                  </div>
                  <span className={`pill${unclusteredDealerships.length ? " active" : ""}`}>
                    {unclusteredDealerships.length} unclustered
                  </span>
                </div>
                {selectedManualDealership ? (
                  <>
                    <p>
                      {selectedManualDealership.address}.{" "}
                      {selectedManualDealership.clusterId
                        ? `Currently assigned to ${getCluster(selectedManualDealership.clusterId, state)?.name || "a field cluster"}.`
                        : "Waiting to be accepted into a field cluster."}
                    </p>
                    {nearestManualCluster ? (
                      <div className="feed-forward">
                        <span className="flow-dot active"></span>
                        <div>
                          <b>Nearest suggested cluster</b>
                          <small>
                            {nearestManualCluster.name} is {formatMiles(nearestManualCluster.distanceMiles)} from this pin.
                          </small>
                        </div>
                      </div>
                    ) : null}
                    <div className="field">
                      <label>Accept into cluster</label>
                      <select
                        className="text-input"
                        value={effectiveManualAssignClusterId}
                        onChange={(event) => setManualAssignClusterId(event.target.value)}
                      >
                        {clusters.map((cluster) => (
                          <option key={cluster.id} value={cluster.id}>
                            {cluster.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label>Or create manual cluster</label>
                      <input
                        className="text-input"
                        value={effectiveManualClusterName}
                        onChange={(event) => setManualClusterName(event.target.value)}
                        placeholder="Auto West / Chiswick field cluster"
                      />
                    </div>
                    <div className="action-row">
                      <button className="btn primary" type="button" onClick={() => assignManualDealershipToCluster()}>
                        Accept into cluster
                      </button>
                      <button className="btn" type="button" onClick={createManualCluster}>
                        Create manual cluster
                      </button>
                    </div>
                  </>
                ) : (
                  <p>Add a dealership from + Location and it will appear here before it is accepted into a field cluster.</p>
                )}
              </div>
              {manualDealerships.length ? (
                <div className="admin-actions discovery-list">
                  <div className="workflow-list-head">
                    <div>
                      <div className="kicker">Manual locations</div>
                      <h3>Added from field discovery</h3>
                    </div>
                    <span className="pill">{manualDealerships.length}</span>
                  </div>
                  {manualDealerships.map((dealership) => (
                    <button
                      key={dealership.id}
                      className={`row${dealership.id === selectedManualDealership?.id ? " selected" : ""}`}
                      type="button"
                      onClick={() => selectManualDealership(dealership.id)}
                    >
                      <span className="number">{dealership.clusterId ? "IN" : "UC"}</span>
                      <div>
                        <h3>{dealership.name}</h3>
                        <small>
                          {dealership.clusterId
                            ? `${getCluster(dealership.clusterId, state)?.name || "Field cluster"}.`
                            : "Unclustered inbox."}{" "}
                          {dealership.address}
                        </small>
                      </div>
                      <span className={`pill${dealership.id === selectedManualDealership?.id ? " active" : ""}`}>
                        {dealership.clusterId ? "Assigned" : "Intake"}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="prospect-summary">
                <div className="section-head">
                  <div>
                    <div className="kicker">Area workflow</div>
                    <h3>{selectedDiscoveryArea?.name || "No area selected"}</h3>
                  </div>
                  <span className={`pill${selectedDiscoveryAreaStatus === "promoted" ? " active" : ""}`}>
                    {selectedDiscoveryAreaStatus === "promoted"
                      ? "Promoted"
                      : selectedDiscoveryAreaStatus === "parked"
                        ? "Parked"
                        : "Candidate"}
                  </span>
                </div>
                <div className="field">
                  <label>Operational cluster name</label>
                  <input
                    className="text-input"
                    value={clusterDraftName}
                    onChange={(event) =>
                      setClusterDrafts((current) => ({
                        ...current,
                        [selectedDiscoveryArea?.id]: event.target.value,
                      }))
                    }
                    placeholder="Wandsworth field cluster"
                  />
                </div>
                <div className="action-row">
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => dispatch({ type: "promote-discovery-area", areaId: selectedDiscoveryArea?.id, name: clusterDraftName })}
                    disabled={!selectedDiscoveryArea}
                  >
                    {promotedCluster ? "Update field cluster" : "Promote to field cluster"}
                  </button>
                  {promotedCluster ? (
                    <button
                      className="btn"
                      type="button"
                      onClick={() => {
                        dispatch({ type: "select-cluster", clusterId: promotedCluster.id });
                        setMapMode("operational");
                      }}
                    >
                      Open field cluster
                    </button>
                  ) : (
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: selectedDiscoveryAreaStatus === "parked" ? "restore-discovery-area" : "park-discovery-area",
                          areaId: selectedDiscoveryArea?.id,
                        })
                      }
                      disabled={!selectedDiscoveryArea}
                    >
                      {selectedDiscoveryAreaStatus === "parked" ? "Restore area" : "Park area"}
                    </button>
                  )}
                </div>
              </div>
              <div className="discovery-workflow-grid">
                <div className="admin-actions">
                  <div className="workflow-list-head">
                    <div>
                      <div className="kicker">Candidate areas</div>
                      <h3>Ready to plan</h3>
                    </div>
                    <span className="pill">{activeDiscoveryAreas.length}</span>
                  </div>
                  {activeDiscoveryAreas.map((area) => (
                    <button
                      key={area.id}
                      className={`row${area.id === selectedDiscoveryArea?.id ? " selected" : ""}`}
                      type="button"
                      onClick={() => setSelectedDiscoveryAreaId(area.id)}
                    >
                      <span className="number">{String(area.count).padStart(2, "0")}</span>
                      <div>
                        <h3>{area.name}</h3>
                        <small>{area.topBrands.join(", ") || "Brand mix still thin"}.</small>
                      </div>
                      <span className={`pill${area.id === selectedDiscoveryArea?.id ? " active" : ""}`}>Fit {area.averageFitScore}</span>
                    </button>
                  ))}
                </div>
                <div className="admin-actions">
                  <div className="workflow-list-head">
                    <div>
                      <div className="kicker">Promoted areas</div>
                      <h3>Operational clusters</h3>
                    </div>
                    <span className="pill active">{promotedDiscoveryAreas.length}</span>
                  </div>
                  {promotedDiscoveryAreas.length ? promotedDiscoveryAreas.map((area) => {
                    const cluster = clusters.find((item) => item.sourceAreaId === area.id);
                    return (
                      <button
                        key={area.id}
                        className={`row${area.id === selectedDiscoveryArea?.id ? " selected" : ""}`}
                        type="button"
                        onClick={() => setSelectedDiscoveryAreaId(area.id)}
                      >
                        <span className="number">{String(area.count).padStart(2, "0")}</span>
                        <div>
                          <h3>{cluster?.name || area.name}</h3>
                          <small>{area.name}. {cluster?.routeTime || "Route pending"}.</small>
                        </div>
                        <span className={`pill${area.id === selectedDiscoveryArea?.id ? " active" : ""}`}>Live</span>
                      </button>
                    );
                  }) : <div className="workflow-empty">No promoted clusters yet.</div>}
                </div>
                <div className="admin-actions">
                  <div className="workflow-list-head">
                    <div>
                      <div className="kicker">Parked areas</div>
                      <h3>Held back for later</h3>
                    </div>
                    <span className="pill">{parkedDiscoveryAreas.length}</span>
                  </div>
                  {parkedDiscoveryAreas.length ? parkedDiscoveryAreas.map((area) => (
                    <button
                      key={area.id}
                      className={`row${area.id === selectedDiscoveryArea?.id ? " selected" : ""}`}
                      type="button"
                      onClick={() => setSelectedDiscoveryAreaId(area.id)}
                    >
                      <span className="number">{String(area.count).padStart(2, "0")}</span>
                      <div>
                        <h3>{area.name}</h3>
                        <small>{area.topBrands.join(", ") || "Brand mix still thin"}.</small>
                      </div>
                      <span className={`pill${area.id === selectedDiscoveryArea?.id ? " active" : ""}`}>Parked</span>
                    </button>
                  )) : <div className="workflow-empty">No parked areas.</div>}
                </div>
              </div>
              <div className="feed-forward">
                <span className="flow-dot active"></span>
                <div>
                  <b>Selected area prospects</b>
                  <small>{selectedDiscoveryArea ? `${selectedDiscoveryArea.count} qualified new-car pins in this search area.` : "Select a discovery area"}</small>
                </div>
              </div>
              {locationTarget ? (
                <div className="prospect-summary">
                  <div className="section-head">
                    <div>
                      <div className="kicker">Nearest live target</div>
                      <h3>{locationTarget.name}</h3>
                    </div>
                    <span className="pill active">{arrivalState}</span>
                  </div>
                  <p>
                    {formatMiles(locationTarget.distanceMiles)} away. {locationTarget.searchOrigin}. {locationTarget.address || "Address not fully tagged."}
                  </p>
                  <div className="action-row">
                    {locationTarget.website ? (
                      <a className="btn" href={locationTarget.website} target="_blank" rel="noreferrer">
                        Open website
                      </a>
                    ) : null}
                    <button className="btn" type="button" onClick={() => locationTargetAreaId && setSelectedDiscoveryAreaId(locationTargetAreaId)}>
                      Jump to area
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="admin-actions discovery-list">
                {selectedDiscoveryProspects.map((prospect) => (
                  <button
                    key={prospect.id}
                    className={`row${prospect.id === selectedDiscoveryProspect?.id ? " selected" : ""}`}
                    type="button"
                    onClick={() => setSelectedDiscoveryProspectId(prospect.id)}
                  >
                    <span className="number">{String(prospect.order).padStart(2, "0")}</span>
                    <div>
                      <h3>{prospect.name}</h3>
                      <small>
                        {prospect.address || "Address not fully tagged"}. {prospect.website ? "Website tagged." : "Website missing."}
                      </small>
                    </div>
                    <span className={`pill${prospect.id === selectedDiscoveryProspect?.id ? " active" : ""}`}>Score {prospect.fitScore}</span>
                  </button>
                ))}
              </div>
              {selectedDiscoveryProspect ? (
                <div className="prospect-summary">
                  <div className="section-head">
                    <div>
                      <div className="kicker">Prospect detail</div>
                      <h3>{selectedDiscoveryProspect.name}</h3>
                    </div>
                    <span className="pill">{selectedDiscoveryProspect.prospectType}</span>
                  </div>
                  <p>{selectedDiscoveryProspect.fitReasons.join(" . ")}</p>
                  {promotedCluster ? <p>Promoted into operational cluster: {promotedCluster.name}.</p> : null}
                  <div className="action-row">
                    {selectedDiscoveryProspect.website ? (
                      <a className="btn" href={selectedDiscoveryProspect.website} target="_blank" rel="noreferrer">
                        Open website
                      </a>
                    ) : null}
                    <button className="btn" type="button" onClick={() => setMapMode("operational")}>
                      Switch to operational map
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="section-head">
                <div>
                  <div className="kicker">Selected territory</div>
                  <h2>{formatClusterLabel(selectedCluster.name)}</h2>
                </div>
                <span className="pill active">Route ready</span>
              </div>
              <p>Coverage fence is now generated from the dealership coordinates in this cluster, so the report shape and the field map stay in sync.</p>
              <div className="grid three stat-strip">
                <div className="metric panel">
                  <strong>{selectedDealers.length}</strong>
                  <span>dealerships</span>
                </div>
                <div className="metric panel">
                  <strong>{warmCount}</strong>
                  <span>warm leads</span>
                </div>
                <div className="metric panel">
                  <strong>{selectedCluster.routeTime}</strong>
                  <span>route time</span>
                </div>
              </div>
              <div className="intel-card">
                <span className="radar-dot"></span>
                <div>
                  <h3>Scraped pins in cluster</h3>
                  <small>{selectedDealers.map((dealer) => dealer.name).join(", ")}</small>
                </div>
              </div>
              <div className="admin-actions">
                {selectedDealers.map((dealer) => (
                  <button
                    key={dealer.id}
                    className={`row${dealer.id === selectedDealership.id ? " selected" : ""}`}
                    type="button"
                    onClick={() => dispatch({ type: "select-dealership", dealershipId: dealer.id })}
                  >
                    <span className="number">{String(dealer.order).padStart(2, "0")}</span>
                    <div>
                      <h3>{dealer.name}</h3>
                      <small>
                        {dealer.roleHint}. {dealer.status}.
                      </small>
                    </div>
                    <span className={`pill${dealer.id === selectedDealership.id ? " active" : ""}`}>{dealer.intelDistance}</span>
                  </button>
                ))}
              </div>
              <div className="feed-forward">
                <span className="flow-dot"></span>
                <div>
                  <b>Next visit input</b>
                  <small>{selectedDealership.nextAction || selectedDealers[0]?.nextAction || "Select a cluster"}</small>
                </div>
              </div>
              {locationTarget ? (
                <div className="prospect-summary">
                  <div className="section-head">
                    <div>
                      <div className="kicker">Nearest dealership</div>
                      <h3>{locationTarget.name}</h3>
                    </div>
                    <span className="pill active">{arrivalState}</span>
                  </div>
                  <p>
                    {formatMiles(locationTarget.distanceMiles)} away. {getCluster(locationTarget.clusterId, state)?.name || locationTarget.clusterId}. {locationTarget.address}
                  </p>
                  <div className="action-row">
                    <button className="btn" type="button" onClick={() => dispatch({ type: "select-dealership", dealershipId: locationTarget.id })}>
                      Open dealership
                    </button>
                    {arrivalState === "On site" || arrivalState === "Nearby" ? (
                      <Link className="btn primary" to="/route" onClick={() => dispatch({ type: "select-dealership", dealershipId: locationTarget.id })}>
                        Log visit now
                      </Link>
                    ) : null}
                    <Link className="btn" to="/leads">
                      Open intel
                    </Link>
                  </div>
                </div>
              ) : null}
              <div className="action-row">
                <Link className="btn primary" to="/route">
                  Start route
                </Link>
                <Link className="btn" to="/leads">
                  Open intel
                </Link>
              </div>
            </>
          )}
        </aside>
      </section>
    </AppLayout>
  );
}
