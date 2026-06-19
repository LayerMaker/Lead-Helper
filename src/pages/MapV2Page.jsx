import { Fragment, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { latLngBounds } from "leaflet";
import { useEffect } from "react";
import { AppLayout } from "../components/AppLayout";
import {
  getMapV2BoundaryForPins,
  getMapV2CenterForPins,
  getMapV2ClusterForPin,
  getMapV2Clusters,
  getMapV2Pins,
  getMapV2PinsForCluster,
  getMapV2UnassignedPins,
} from "../lib/mapV2Model";
import { useAppState } from "../state/AppState";

const clusterColours = {
  amber: "#f3a53d",
  mint: "#7ae3b8",
  rose: "#ff7fa7",
  teal: "#2fd4d4",
  lime: "#b8de6f",
  violet: "#d8a7ff",
};

function getClusterColour(cluster) {
  return clusterColours[cluster?.colour] || "#f3a53d";
}

function FitToMapV2({ pins, selectedClusterPins }) {
  const map = useMap();

  useEffect(() => {
    const points = [...selectedClusterPins, ...pins].map((pin) => pin.location).filter((location) => Array.isArray(location));
    if (!points.length) return;
    map.fitBounds(latLngBounds(points), { padding: [34, 34], maxZoom: 13 });
  }, [map, pins, selectedClusterPins]);

  return null;
}

function MapV2Canvas({ state, clusters, pins, selectedCluster, selectedPinId, onSelectCluster, onSelectPin }) {
  const selectedClusterPins = useMemo(() => getMapV2PinsForCluster(state, selectedCluster.id), [selectedCluster.id, state]);
  const center = getMapV2CenterForPins(selectedClusterPins.length ? selectedClusterPins : pins);
  const clusterGeometry = useMemo(
    () =>
      clusters.map((cluster) => {
        const clusterPins = getMapV2PinsForCluster(state, cluster.id);
        return {
          cluster,
          pins: clusterPins,
          boundary: getMapV2BoundaryForPins(clusterPins),
        };
      }),
    [clusters, state],
  );
  const selectedBoundary = getMapV2BoundaryForPins(selectedClusterPins);

  return (
    <MapContainer center={center} zoom={11} scrollWheelZoom className="field-map" attributionControl>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitToMapV2 pins={pins} selectedClusterPins={selectedClusterPins} />

      {clusterGeometry.map(({ cluster, boundary, pins: clusterPins }) => {
        const isSelected = cluster.id === selectedCluster.id;
        const colour = getClusterColour(cluster);
        const linePositions = boundary.length ? boundary : clusterPins.map((pin) => pin.location).filter((location) => Array.isArray(location));

        return (
          <Fragment key={cluster.id}>
            {boundary.length ? (
              <Polygon
                positions={boundary}
                pathOptions={{
                  color: colour,
                  weight: isSelected ? 5 : 3,
                  fillColor: colour,
                  fillOpacity: isSelected ? 0.2 : 0.08,
                  opacity: isSelected ? 0.98 : 0.52,
                  lineJoin: "miter",
                }}
                eventHandlers={{
                  click: () => onSelectCluster(cluster.id),
                }}
              >
                <Tooltip sticky direction="center" className={`map-tooltip ${isSelected ? "selected" : ""}`}>
                  {cluster.name} pin-to-pin boundary
                </Tooltip>
              </Polygon>
            ) : linePositions.length > 1 ? (
              <Polyline
                positions={linePositions}
                pathOptions={{
                  color: colour,
                  weight: isSelected ? 5 : 3,
                  opacity: isSelected ? 0.95 : 0.5,
                }}
                eventHandlers={{
                  click: () => onSelectCluster(cluster.id),
                }}
              />
            ) : null}
          </Fragment>
        );
      })}

      {selectedBoundary.length ? (
        <Polyline
          positions={[...selectedBoundary, selectedBoundary[0]]}
          pathOptions={{ color: "#fff4df", weight: 1, opacity: 0.8, dashArray: "2 8" }}
          interactive={false}
        />
      ) : null}

      {pins
        .filter((pin) => Array.isArray(pin.location))
        .map((pin) => {
          const cluster = getMapV2ClusterForPin(state, pin.id);
          const isSelected = pin.id === selectedPinId;
          const colour = cluster ? getClusterColour(cluster) : "#f3a53d";

          return (
            <CircleMarker
              key={pin.id}
              center={pin.location}
              radius={isSelected ? 10 : 7}
              pathOptions={{
                color: isSelected ? "#fff4df" : colour,
                weight: isSelected ? 3 : 2,
                fillColor: cluster ? colour : "#f3a53d",
                fillOpacity: cluster ? 0.82 : 0.95,
                dashArray: cluster ? undefined : "5 5",
              }}
              eventHandlers={{
                click: () => onSelectPin(pin.id),
              }}
            >
              <Tooltip direction="top" offset={[0, -8]} className={`map-tooltip marker ${isSelected ? "selected" : ""}`}>
                {pin.name} {cluster ? `(${cluster.name})` : "(unassigned)"}
              </Tooltip>
            </CircleMarker>
          );
        })}

      {selectedBoundary.map((location, index) => (
        <CircleMarker
          key={`${selectedCluster.id}-boundary-vertex-${index}`}
          center={location}
          radius={5}
          pathOptions={{
            color: "#fff4df",
            weight: 2,
            fillColor: "#ff9dcb",
            fillOpacity: 1,
          }}
          interactive={false}
        />
      ))}
    </MapContainer>
  );
}

export function MapV2Page() {
  const { state, dispatch } = useAppState();
  const clusters = getMapV2Clusters(state);
  const pins = getMapV2Pins(state);
  const unassignedPins = getMapV2UnassignedPins(state);
  const [selectedClusterId, setSelectedClusterId] = useState(clusters[0]?.id || "");
  const [selectedPinId, setSelectedPinId] = useState(unassignedPins[0]?.id || pins[0]?.id || "");

  const selectedCluster = clusters.find((cluster) => cluster.id === selectedClusterId) || clusters[0];
  const selectedPin = pins.find((pin) => pin.id === selectedPinId) || unassignedPins[0] || pins[0] || null;
  const selectedClusterPins = selectedCluster ? getMapV2PinsForCluster(state, selectedCluster.id) : [];
  const selectedPinCluster = selectedPin ? getMapV2ClusterForPin(state, selectedPin.id) : null;

  function assignSelectedPin() {
    if (!selectedPin || !selectedCluster) return;
    dispatch({
      type: "assign-map-v2-pin",
      pinId: selectedPin.id,
      clusterId: selectedCluster.id,
      options: {
        assignmentType: "manual",
        assignedBy: "user",
      },
    });
  }

  return (
    <AppLayout statusLine="Map V2 - pin assignments and generated boundaries">
      <section className="title-row">
        <div>
          <div className="kicker">Map V2</div>
          <h1>Pin-first cluster architecture running beside the stable map.</h1>
          <p className="subtle-copy">
            This page proves the new model: pins stay independent, assignments control cluster membership, and boundaries connect assigned pins directly.
          </p>
        </div>
        <div className="action-row">
          <span className="pill active">{pins.length} pins</span>
          <span className="pill">{unassignedPins.length} unassigned</span>
        </div>
      </section>

      <section className="map-shell">
        <div className="panel map live-map-panel">
          {selectedCluster ? (
            <MapV2Canvas
              state={state}
              clusters={clusters}
              pins={pins}
              selectedCluster={selectedCluster}
              selectedPinId={selectedPin?.id || ""}
              onSelectCluster={setSelectedClusterId}
              onSelectPin={setSelectedPinId}
            />
          ) : (
            <div className="workflow-empty">Map V2 has no clusters yet.</div>
          )}
        </div>

        <aside className="panel pad cluster-drawer">
          <div className="section-head">
            <div>
              <div className="kicker">Selected cluster</div>
              <h2>{selectedCluster?.name || "No cluster"}</h2>
            </div>
            <span className="pill active">{selectedCluster?.lifecycle || "V2"}</span>
          </div>

          <div className="grid three stat-strip">
            <div className="metric panel">
              <strong>{selectedClusterPins.length}</strong>
              <span>assigned pins</span>
            </div>
            <div className="metric panel">
              <strong>{clusters.length}</strong>
              <span>clusters</span>
            </div>
            <div className="metric panel">
              <strong>{unassignedPins.length}</strong>
              <span>inbox</span>
            </div>
          </div>

          <div className="field">
            <label>Cluster assignment target</label>
            <select className="text-input" value={selectedCluster?.id || ""} onChange={(event) => setSelectedClusterId(event.target.value)}>
              {clusters.map((cluster) => (
                <option key={cluster.id} value={cluster.id}>
                  {cluster.name}
                </option>
              ))}
            </select>
          </div>

          <div className="prospect-summary">
            <div className="section-head">
              <div>
                <div className="kicker">Selected pin</div>
                <h3>{selectedPin?.name || "No pin selected"}</h3>
              </div>
              <span className={`pill${selectedPinCluster ? " active" : ""}`}>{selectedPinCluster?.name || "Unassigned"}</span>
            </div>
            {selectedPin ? (
              <>
                <p>{selectedPin.address}</p>
                <div className="action-row">
                  <button className="btn primary" type="button" onClick={assignSelectedPin} disabled={!selectedCluster || !selectedPin}>
                    Assign selected pin
                  </button>
                </div>
              </>
            ) : (
              <p>Add a pin from + Location to populate the V2 pin inbox.</p>
            )}
          </div>

          <div className="admin-actions discovery-list">
            <div className="workflow-list-head">
              <div>
                <div className="kicker">Unassigned pin inbox</div>
                <h3>Ready for manual cluster assignment</h3>
              </div>
              <span className="pill">{unassignedPins.length}</span>
            </div>
            {unassignedPins.length ? (
              unassignedPins.map((pin) => (
                <button
                  key={pin.id}
                  className={`row${pin.id === selectedPin?.id ? " selected" : ""}`}
                  type="button"
                  onClick={() => setSelectedPinId(pin.id)}
                >
                  <span className="number">UC</span>
                  <div>
                    <h3>{pin.name}</h3>
                    <small>{pin.address}</small>
                  </div>
                  <span className={`pill${pin.id === selectedPin?.id ? " active" : ""}`}>Pin</span>
                </button>
              ))
            ) : (
              <div className="workflow-empty">No unassigned V2 pins.</div>
            )}
          </div>

          <div className="admin-actions discovery-list">
            <div className="workflow-list-head">
              <div>
                <div className="kicker">Selected cluster pins</div>
                <h3>{selectedCluster?.name || "Cluster"}</h3>
              </div>
              <span className="pill active">{selectedClusterPins.length}</span>
            </div>
            {selectedClusterPins.map((pin) => (
              <button
                key={pin.id}
                className={`row${pin.id === selectedPin?.id ? " selected" : ""}`}
                type="button"
                onClick={() => setSelectedPinId(pin.id)}
              >
                <span className="number">IN</span>
                <div>
                  <h3>{pin.name}</h3>
                  <small>{pin.address}</small>
                </div>
                <span className={`pill${pin.id === selectedPin?.id ? " active" : ""}`}>Assigned</span>
              </button>
            ))}
          </div>
        </aside>
      </section>
    </AppLayout>
  );
}
