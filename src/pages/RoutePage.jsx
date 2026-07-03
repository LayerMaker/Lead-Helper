import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "../components/AppLayout";
import { useAppState } from "../state/AppState";

const routeClusterColours = {
  amber: "#f3a53d",
  mint: "#7ae3b8",
  rose: "#ff7fa7",
  teal: "#2fd4d4",
  lime: "#b8de6f",
  violet: "#d8a7ff",
  cyan: "#53d7ff",
  coral: "#ff9b73",
  blue: "#80b7ff",
  gold: "#f0df88",
  orchid: "#e58cff",
  slate: "#9aa7b8",
};

function getRouteClusterColour(cluster) {
  return routeClusterColours[cluster?.colour] || "#f3a53d";
}

function getRouteClusterLabel(cluster, index, pinCount = 0) {
  const cleanName = String(cluster?.name || "").trim();
  const fallback = cluster?.lifecycle === "manual" ? `Field cluster ${index + 1}` : `Cluster ${index + 1}`;
  const name = cleanName && !/^manual field cluster$/i.test(cleanName) ? cleanName : fallback;
  return `${String(index + 1).padStart(2, "0")} - ${name}${pinCount ? ` (${pinCount} pins)` : ""}`;
}

function getMapV2PinsForRouteCluster(state, clusterId) {
  const assignedPinIds = new Set(
    (state.mapV2?.assignments || [])
      .filter((assignment) => assignment.clusterId === clusterId && assignment.assignmentType !== "rejected")
      .map((assignment) => assignment.pinId),
  );
  return (state.mapV2?.pins || []).filter((pin) => assignedPinIds.has(pin.id));
}

function getRouteClusterItems(state) {
  return (state.mapV2?.clusters || [])
    .map((cluster, index) => ({
      cluster,
      index,
      pins: getMapV2PinsForRouteCluster(state, cluster.id),
    }))
    .filter((item) => item.pins.length);
}

function getDistanceMiles(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return Number.POSITIVE_INFINITY;
  const earthMiles = 3958.8;
  const toRadians = (value) => (value * Math.PI) / 180;
  const deltaLat = toRadians(right[0] - left[0]);
  const deltaLng = toRadians(right[1] - left[1]);
  const lat1 = toRadians(left[0]);
  const lat2 = toRadians(right[0]);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return earthMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getCenterLocation(stops) {
  const locations = stops.map((stop) => stop.location).filter((location) => Array.isArray(location));
  if (!locations.length) return null;
  return [
    locations.reduce((total, location) => total + location[0], 0) / locations.length,
    locations.reduce((total, location) => total + location[1], 0) / locations.length,
  ];
}

function sortRouteStops(stops) {
  const center = getCenterLocation(stops);
  return [...stops].sort((left, right) => {
    const leftDistance = getDistanceMiles(center, left.location);
    const rightDistance = getDistanceMiles(center, right.location);
    return leftDistance - rightDistance || left.name.localeCompare(right.name);
  });
}

function buildStopFromPin({ pin, getDealershipById }) {
  const dealershipId = pin.legacyDealershipId || pin.dealershipId || "";
  const dealership = dealershipId ? getDealershipById(dealershipId) : null;
  const hasDealership = Boolean(dealership?.id);
  const id = hasDealership ? dealership.id : pin.id;

  return {
    id,
    pinId: pin.id,
    dealershipId: hasDealership ? dealership.id : "",
    name: pin.name || dealership?.name || "Unnamed dealership",
    address: pin.address || dealership?.address || "Address not captured",
    roleHint: dealership?.roleHint || "Ask for showroom manager or business manager",
    contactHint: dealership?.contactHint || "",
    location: Array.isArray(dealership?.location) ? dealership.location : pin.location,
  };
}

function buildSelectedMapsUrl(stop) {
  const destination = Array.isArray(stop?.location) ? stop.location.join(",") : `${stop?.name || ""} ${stop?.address || ""}`.trim();
  if (!destination) return "https://www.google.com/maps";
  const params = new URLSearchParams({
    api: "1",
    destination,
    travelmode: "driving",
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function RouteClusterPicker({ routeClusterId, routeItems, onChange }) {
  return (
    <section className="dashboard-focus-control route-focus-control">
      <div>
        <div className="kicker">Route cluster</div>
        <h2>Select the cluster you are working.</h2>
        <small>Live from the clusters drawn on the map. Pick by colour, then choose the next dealership below.</small>
      </div>
      <div className="dashboard-focus-picker" aria-label="Route cluster selection">
        {routeItems.map(({ cluster, index, pins }) => {
          const isSelected = cluster.id === routeClusterId;
          return (
            <button
              className={`dashboard-focus-chip${isSelected ? " selected" : ""}`}
              key={cluster.id}
              style={{ "--focus-cluster-colour": getRouteClusterColour(cluster) }}
              type="button"
              onClick={() => onChange(cluster.id)}
            >
              <span className="dashboard-focus-dot" aria-hidden="true"></span>
              <span>
                <b>{getRouteClusterLabel(cluster, index, pins.length)}</b>
                <small>{cluster.lifecycle === "manual" ? "Drawn map cluster" : "Map cluster"}</small>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function RoutePage() {
  const { state, selectedCluster, getDealershipById, dispatch } = useAppState();
  const routeItems = useMemo(() => getRouteClusterItems(state), [state]);
  const [routeClusterId, setRouteClusterId] = useState(
    routeItems.find((item) => item.cluster.id === selectedCluster.id)?.cluster.id || routeItems[0]?.cluster.id || "",
  );
  const activeRouteItem = routeItems.find((item) => item.cluster.id === routeClusterId) || routeItems[0] || null;
  const routeCluster = activeRouteItem?.cluster || null;
  const routeStops = useMemo(
    () =>
      activeRouteItem
        ? sortRouteStops(activeRouteItem.pins.map((pin) => buildStopFromPin({ pin, getDealershipById })))
        : [],
    [activeRouteItem, getDealershipById],
  );
  const [selectedStopId, setSelectedStopId] = useState("");
  const selectedStop = routeStops.find((stop) => stop.id === selectedStopId || stop.pinId === selectedStopId) || routeStops[0] || null;
  const mapsUrl = buildSelectedMapsUrl(selectedStop);
  const clusterIndex = activeRouteItem?.index ?? 0;

  useEffect(() => {
    if (selectedStop?.dealershipId) {
      dispatch({ type: "select-dealership", dealershipId: selectedStop.dealershipId });
    }
  }, [dispatch, selectedStop?.dealershipId]);

  function selectStop(stop) {
    setSelectedStopId(stop.id);
    if (stop.dealershipId) {
      dispatch({ type: "select-dealership", dealershipId: stop.dealershipId });
    }
  }

  return (
    <AppLayout statusLine={routeCluster ? `${routeCluster.name} Route - ${routeStops.length} stops` : "Route - select a map cluster"}>
      <section className="title-row">
        <div>
          <div className="kicker">Cluster route</div>
          <h1>{routeCluster ? getRouteClusterLabel(routeCluster, clusterIndex, routeStops.length) : "Select a route cluster."}</h1>
          <p className="subtle-copy">Choose the map cluster you are working, tap the dealership you want next, then open it in your phone maps app.</p>
        </div>
        <a className={`btn primary${selectedStop ? "" : " disabled"}`} href={selectedStop ? mapsUrl : "#"} target="_blank" rel="noreferrer">
          Open selected in maps
        </a>
      </section>

      {routeItems.length ? (
        <RouteClusterPicker
          routeClusterId={activeRouteItem?.cluster.id || ""}
          routeItems={routeItems}
          onChange={(clusterId) => {
            setRouteClusterId(clusterId);
            setSelectedStopId("");
          }}
        />
      ) : (
        <section className="panel pad">
          <div className="kicker">No route clusters</div>
          <h2>Create a cluster on the Map first.</h2>
          <small>Route uses map clusters with assigned dealership pins as its source of truth.</small>
        </section>
      )}

      <section className="panel table route-stop-list" style={{ "--focus-cluster-colour": getRouteClusterColour(routeCluster) }}>
        {routeStops.length ? (
          routeStops.map((stop, index) => {
            const isSelected = selectedStop?.id === stop.id || selectedStop?.pinId === stop.pinId;
            return (
              <button className={`row route-stop-row${isSelected ? " selected" : ""}`} key={stop.pinId} type="button" onClick={() => selectStop(stop)}>
                <span className="number">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{stop.name}</h3>
                  <small>
                    {stop.address} - {stop.contactHint || stop.roleHint}
                  </small>
                </div>
                <span className={`pill${isSelected ? " active" : ""}`}>{isSelected ? "Selected" : "Tap"}</span>
              </button>
            );
          })
        ) : (
          <div className="row">
            <span className="number">--</span>
            <div>
              <h3>No dealerships in this cluster</h3>
              <small>Assign pins to this cluster on the Map, then Route will populate automatically.</small>
            </div>
          </div>
        )}
      </section>

      {selectedStop ? (
        <section className="panel pad" style={{ marginTop: 14 }}>
          <div className="section-head">
            <div>
              <div className="kicker">Selected stop</div>
              <h2>{selectedStop.name}</h2>
              <small>{selectedStop.address}</small>
            </div>
            <span className="pill active">Loaded across app</span>
          </div>
          <div className="action-row">
            <a className="btn primary" href={mapsUrl} target="_blank" rel="noreferrer">
              Open in Maps
            </a>
            <Link className="btn" to="/location">
              Location + notes
            </Link>
            <Link className="btn primary" to="/leads">
              Log visit
            </Link>
            <Link className="btn" to="/email">
              Email
            </Link>
          </div>
        </section>
      ) : null}
    </AppLayout>
  );
}
