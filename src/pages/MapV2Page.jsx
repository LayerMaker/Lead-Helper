import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { latLngBounds } from "leaflet";
import { AppLayout } from "../components/AppLayout";
import {
  getMapV2BoundaryForPins,
  getMapV2CenterForPins,
  getMapV2ClusterForPin,
  getMapV2Clusters,
  getMapV2Pins,
  getMapV2PinsForCluster,
  getMapV2UnassignedPins,
  isMapV2PointInsidePolygon,
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

function MapInteractionGate({ drawMode, mapRef }) {
  const map = useMap();

  useEffect(() => {
    mapRef.current = map;
    return () => {
      if (mapRef.current === map) mapRef.current = null;
    };
  }, [map, mapRef]);

  useEffect(() => {
    const controls = [map.dragging, map.touchZoom, map.doubleClickZoom, map.scrollWheelZoom, map.boxZoom, map.keyboard].filter(Boolean);
    if (drawMode) {
      controls.forEach((control) => control.disable());
      return () => controls.forEach((control) => control.enable());
    }
    controls.forEach((control) => control.enable());
    return undefined;
  }, [drawMode, map]);

  return null;
}

function getPointerRelativeToFrame(event, frame) {
  const rect = frame.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function distanceBetweenPoints(left, right) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function isScreenPointInsidePolygon(point, polygon) {
  if (!point || !Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;

  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y || Number.EPSILON) + current.x;

    if (intersects) inside = !inside;
  }

  return inside;
}

function MapV2Canvas({
  state,
  clusters,
  pins,
  selectedCluster,
  selectedPinId,
  lassoPinIds,
  drawMode,
  onSelectCluster,
  onSelectPin,
  onDrawComplete,
}) {
  const frameRef = useRef(null);
  const mapRef = useRef(null);
  const drawScreenPathRef = useRef([]);
  const drawGeoPathRef = useRef([]);
  const [isPointerDrawing, setIsPointerDrawing] = useState(false);
  const [drawScreenPath, setDrawScreenPath] = useState([]);
  const [drawGeoPath, setDrawGeoPath] = useState([]);
  const selectedClusterPins = useMemo(() => getMapV2PinsForCluster(state, selectedCluster.id), [selectedCluster.id, state]);
  const lassoPinIdSet = useMemo(() => new Set(lassoPinIds), [lassoPinIds]);
  const lassoPins = useMemo(() => pins.filter((pin) => lassoPinIdSet.has(pin.id)), [lassoPinIdSet, pins]);
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
  const lassoBoundary = getMapV2BoundaryForPins(lassoPins);

  function getDrawPoint(event) {
    if (!frameRef.current || !mapRef.current) return null;
    const screen = getPointerRelativeToFrame(event, frameRef.current);
    const latLng = mapRef.current.containerPointToLatLng([screen.x, screen.y]);
    return {
      screen,
      geo: [latLng.lat, latLng.lng],
    };
  }

  function beginDraw(event) {
    if (!drawMode) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = getDrawPoint(event);
    if (!point) return;
    setIsPointerDrawing(true);
    drawScreenPathRef.current = [point.screen];
    drawGeoPathRef.current = [point.geo];
    setDrawScreenPath([point.screen]);
    setDrawGeoPath([point.geo]);
  }

  function continueDraw(event) {
    if (!drawMode || !isPointerDrawing) return;
    event.preventDefault();
    const point = getDrawPoint(event);
    if (!point) return;

    const lastScreenPoint = drawScreenPathRef.current[drawScreenPathRef.current.length - 1];
    if (distanceBetweenPoints(lastScreenPoint, point.screen) < 5) return;

    drawScreenPathRef.current = [...drawScreenPathRef.current, point.screen];
    drawGeoPathRef.current = [...drawGeoPathRef.current, point.geo];
    setDrawScreenPath(drawScreenPathRef.current);
    setDrawGeoPath(drawGeoPathRef.current);
  }

  function finishDraw(event) {
    if (!drawMode || !isPointerDrawing) return;
    event.preventDefault();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setIsPointerDrawing(false);
    const screenPath = drawScreenPathRef.current;
    const selectedPinIds = pins
      .filter((pin) => Array.isArray(pin.location))
      .filter((pin) => {
        if (!mapRef.current) return false;
        const point = mapRef.current.latLngToContainerPoint(pin.location);
        return isScreenPointInsidePolygon({ x: point.x, y: point.y }, screenPath);
      })
      .map((pin) => pin.id);
    onDrawComplete(drawGeoPathRef.current.length ? drawGeoPathRef.current : drawGeoPath, selectedPinIds);
    setDrawScreenPath([]);
    setDrawGeoPath([]);
    drawScreenPathRef.current = [];
    drawGeoPathRef.current = [];
  }

  return (
    <div className={`map-v2-frame${drawMode ? " drawing" : ""}`} ref={frameRef}>
      <MapContainer center={center} zoom={11} scrollWheelZoom className="field-map" attributionControl>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapInteractionGate drawMode={drawMode} mapRef={mapRef} />
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

        {lassoBoundary.length ? (
          <Polygon
            positions={lassoBoundary}
            pathOptions={{
              color: "#fff4df",
              weight: 2,
              fillColor: "#ff7fa7",
              fillOpacity: 0.18,
              dashArray: "8 8",
            }}
            interactive={false}
          />
        ) : null}

        {pins
          .filter((pin) => Array.isArray(pin.location))
          .map((pin) => {
            const cluster = getMapV2ClusterForPin(state, pin.id);
            const isSelected = pin.id === selectedPinId;
            const isLassoSelected = lassoPinIdSet.has(pin.id);
            const colour = cluster ? getClusterColour(cluster) : "#f3a53d";

            return (
              <CircleMarker
                key={pin.id}
                center={pin.location}
                radius={isSelected || isLassoSelected ? 10 : 7}
                pathOptions={{
                  color: isLassoSelected ? "#fff4df" : isSelected ? "#fff4df" : colour,
                  weight: isLassoSelected ? 4 : isSelected ? 3 : 2,
                  fillColor: isLassoSelected ? "#ff7fa7" : cluster ? colour : "#f3a53d",
                  fillOpacity: cluster || isLassoSelected ? 0.88 : 0.95,
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

      {drawMode ? (
        <div
          className="map-v2-draw-overlay"
          onPointerDown={beginDraw}
          onPointerMove={continueDraw}
          onPointerUp={finishDraw}
          onPointerCancel={finishDraw}
        >
          <div className="map-v2-draw-banner">
            <strong>Drawing selection</strong>
            <span>Draw around pins, then release to review the selection.</span>
          </div>
          <svg className="map-v2-draw-svg" aria-hidden="true">
            {isPointerDrawing && drawScreenPath.length > 1 ? (
              <>
                <polyline points={drawScreenPath.map((point) => `${point.x},${point.y}`).join(" ")} className="map-v2-lasso-line" />
                {drawScreenPath.length > 3 ? (
                  <polygon points={drawScreenPath.map((point) => `${point.x},${point.y}`).join(" ")} className="map-v2-lasso-fill" />
                ) : null}
              </>
            ) : null}
          </svg>
        </div>
      ) : null}
    </div>
  );
}

export function MapV2Page() {
  const { state, dispatch } = useAppState();
  const clusters = getMapV2Clusters(state);
  const pins = getMapV2Pins(state);
  const unassignedPins = getMapV2UnassignedPins(state);
  const [selectedClusterId, setSelectedClusterId] = useState(clusters[0]?.id || "");
  const [selectedPinId, setSelectedPinId] = useState(unassignedPins[0]?.id || pins[0]?.id || "");
  const [drawMode, setDrawMode] = useState(false);
  const [lassoPinIds, setLassoPinIds] = useState([]);
  const [manualClusterName, setManualClusterName] = useState("Manual field cluster");

  const selectedCluster = clusters.find((cluster) => cluster.id === selectedClusterId) || clusters[0];
  const selectedPin = pins.find((pin) => pin.id === selectedPinId) || unassignedPins[0] || pins[0] || null;
  const selectedClusterPins = selectedCluster ? getMapV2PinsForCluster(state, selectedCluster.id) : [];
  const selectedPinCluster = selectedPin ? getMapV2ClusterForPin(state, selectedPin.id) : null;
  const lassoPins = pins.filter((pin) => lassoPinIds.includes(pin.id));

  function startDrawing() {
    setDrawMode(true);
    setLassoPinIds([]);
  }

  function cancelDrawing() {
    setDrawMode(false);
  }

  function clearLassoSelection() {
    setDrawMode(false);
    setLassoPinIds([]);
  }

  function handleDrawComplete(polygon, selectedPinIds = []) {
    setDrawMode(false);
    if (!selectedPinIds.length && (!Array.isArray(polygon) || polygon.length < 3)) {
      setLassoPinIds([]);
      return;
    }

    const selectedPins = selectedPinIds.length
      ? pins.filter((pin) => selectedPinIds.includes(pin.id))
      : pins.filter((pin) => isMapV2PointInsidePolygon(pin.location, polygon));
    setLassoPinIds(selectedPins.map((pin) => pin.id));
    if (selectedPins[0]) {
      setSelectedPinId(selectedPins[0].id);
      setManualClusterName(`${selectedPins[0].name.split(/\s+/).slice(0, 2).join(" ")} field cluster`);
    }
  }

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

  function createClusterFromLasso() {
    if (!lassoPinIds.length) return;
    dispatch({
      type: "create-map-v2-cluster-from-pins",
      pinIds: lassoPinIds,
      name: manualClusterName,
    });
    clearLassoSelection();
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
        <div className="map-v2-workspace">
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
                lassoPinIds={lassoPinIds}
                drawMode={drawMode}
                onDrawComplete={handleDrawComplete}
              />
            ) : (
              <div className="workflow-empty">Map V2 has no clusters yet.</div>
            )}
          </div>

          <div className={`prospect-summary map-v2-lasso-panel${drawMode ? " selected" : ""}`}>
            <div className="section-head">
              <div>
                <div className="kicker">Lasso cluster selection</div>
                <h3>{drawMode ? "Drawing mode active" : `${lassoPins.length} pins selected`}</h3>
              </div>
              <span className={`pill${drawMode || lassoPins.length ? " active" : ""}`}>{drawMode ? "Draw" : "Review"}</span>
            </div>
            <p>
              {drawMode
                ? "Map pan and zoom are paused. Draw around the pins you want, then release to review them."
                : lassoPins.length
                  ? "Review the selected pins before creating a new manual cluster."
                  : "Use Draw selection to safely select several pins without accidental cluster edits."}
            </p>
            <div className="field">
              <label>New cluster name</label>
              <input
                className="text-input"
                value={manualClusterName}
                onChange={(event) => setManualClusterName(event.target.value)}
                placeholder="Wandsworth north field cluster"
              />
            </div>
            <div className="action-row map-v2-lasso-actions">
              <button className={`btn${drawMode ? " primary" : ""}`} type="button" onClick={drawMode ? cancelDrawing : startDrawing}>
                {drawMode ? "Cancel drawing" : "Draw selection"}
              </button>
              <button className="btn primary" type="button" onClick={createClusterFromLasso} disabled={!lassoPins.length}>
                Create cluster from selection
              </button>
              <button className="btn" type="button" onClick={clearLassoSelection} disabled={!drawMode && !lassoPins.length}>
                Clear
              </button>
            </div>

            {lassoPins.length ? (
              <div className="admin-actions discovery-list map-v2-lasso-list">
                <div className="workflow-list-head">
                  <div>
                    <div className="kicker">Selected by lasso</div>
                    <h3>Cluster preview pins</h3>
                  </div>
                  <span className="pill active">{lassoPins.length}</span>
                </div>
                {lassoPins.map((pin) => (
                  <button
                    key={pin.id}
                    className={`row${pin.id === selectedPin?.id ? " selected" : ""}`}
                    type="button"
                    onClick={() => setSelectedPinId(pin.id)}
                  >
                    <span className="number">LS</span>
                    <div>
                      <h3>{pin.name}</h3>
                      <small>{pin.address}</small>
                    </div>
                    <span className={`pill${pin.id === selectedPin?.id ? " active" : ""}`}>Selected</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
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
