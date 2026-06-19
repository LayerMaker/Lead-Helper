import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { latLngBounds } from "leaflet";
import { useEffect, useMemo } from "react";
import { getClusterCenter, getClusterCoveragePolygon, getClusterRouteCoordinates } from "../lib/leadHelperModel";

const colorClassMap = {
  "territory-amber": "#f3a53d",
  "territory-mint": "#7ae3b8",
  "territory-rose": "#ff7fa7",
  "territory-teal": "#2fd4d4",
};

function getClusterColor(cluster) {
  if (!cluster) return "#b8c0cc";
  return colorClassMap[cluster?.colorClass] || "#f3a53d";
}

function FitToSelection({ selectedPolygon, selectedDealers, userLocation }) {
  const map = useMap();

  useEffect(() => {
    const points = [...selectedPolygon, ...selectedDealers.map((dealer) => dealer.location).filter(Boolean)];
    if (userLocation) points.push(userLocation);
    if (!points.length) return;
    map.fitBounds(latLngBounds(points), { padding: [32, 32], maxZoom: 14 });
  }, [map, selectedPolygon, selectedDealers, userLocation]);

  return null;
}

export function FieldMap({ state, clusters, selectedCluster, selectedDealershipId, selectedDealers, allDealers, onSelectCluster, onSelectDealership, userLocation }) {
  const derivedClusters = useMemo(
    () =>
      clusters.map((cluster) => ({
        ...cluster,
        center: getClusterCenter(state, cluster.id),
        polygon: getClusterCoveragePolygon(state, cluster.id),
      })),
    [clusters, state],
  );
  const selectedClusterGeometry = derivedClusters.find((cluster) => cluster.id === selectedCluster.id) || {
    ...selectedCluster,
    center: getClusterCenter(state, selectedCluster.id),
    polygon: getClusterCoveragePolygon(state, selectedCluster.id),
  };
  const routeLine = useMemo(
    () => getClusterRouteCoordinates(state, selectedCluster.id),
    [selectedCluster.id, state],
  );
  const selectedFenceVertices = useMemo(() => {
    if (selectedClusterGeometry.polygon.length <= 8) return selectedClusterGeometry.polygon;
    const step = Math.max(1, Math.floor(selectedClusterGeometry.polygon.length / 6));
    return selectedClusterGeometry.polygon.filter((_, index) => index % step === 0).slice(0, 6);
  }, [selectedClusterGeometry.polygon]);

  return (
    <MapContainer
      center={selectedClusterGeometry.center}
      zoom={12}
      scrollWheelZoom
      className="field-map"
      attributionControl
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitToSelection selectedPolygon={selectedClusterGeometry.polygon} selectedDealers={selectedDealers} userLocation={userLocation} />

      {derivedClusters.map((cluster) => {
        const isSelected = cluster.id === selectedCluster.id;
        const color = getClusterColor(cluster);
        if (!cluster.polygon.length) return null;

        return (
          <Polygon
            key={cluster.id}
            positions={cluster.polygon}
            pathOptions={{
              color,
              weight: isSelected ? 4 : 2,
              fillColor: color,
              fillOpacity: isSelected ? 0.22 : 0.1,
              opacity: isSelected ? 0.95 : 0.55,
            }}
            eventHandlers={{
              click: () => onSelectCluster(cluster.id),
            }}
          >
            <Tooltip sticky direction="center" className={`map-tooltip ${isSelected ? "selected" : ""}`}>
              {cluster.name}
            </Tooltip>
          </Polygon>
        );
      })}

      {selectedFenceVertices.map((point, index) => (
        <CircleMarker
          key={`${selectedCluster.id}-vertex-${index}`}
          center={point}
          radius={4}
          pathOptions={{
            color: "#fff2d6",
            weight: 2,
            fillColor: getClusterColor(selectedCluster),
            fillOpacity: 1,
          }}
          interactive={false}
        />
      ))}

      {routeLine.length > 1 ? (
        <>
          <Polyline positions={routeLine} pathOptions={{ color: "#1c140e", weight: 10, opacity: 0.35 }} />
          <Polyline positions={routeLine} pathOptions={{ color: getClusterColor(selectedCluster), weight: 5, opacity: 0.9, dashArray: "10 10" }} />
        </>
      ) : null}

      {allDealers.filter((dealer) => Array.isArray(dealer.location)).map((dealer) => {
        const isCurrent = dealer.id === selectedDealershipId;
        const assignedCluster = clusters.find((cluster) => cluster.id === dealer.clusterId);
        const clusterColor = getClusterColor(assignedCluster);
        const isWarm = dealer.status === "Interested" || dealer.status === "Site walk booked";
        const isDue = dealer.status === "Follow-up due";
        const isUnclustered = !dealer.clusterId;
        const radius = isCurrent ? 10 : 7;

        return (
          <CircleMarker
            key={dealer.id}
            center={dealer.location}
            radius={radius}
            pathOptions={{
              color: isCurrent ? "#fff4df" : clusterColor,
              weight: isCurrent ? 3 : 2,
              fillColor: isUnclustered ? "#f3a53d" : isWarm ? "#f7c66f" : isDue ? "#f0df88" : clusterColor,
              fillOpacity: isUnclustered ? 0.88 : dealer.clusterId === selectedCluster.id ? 0.95 : 0.7,
              dashArray: isUnclustered ? "5 5" : undefined,
            }}
            eventHandlers={{
              click: () => onSelectDealership(dealer.id),
            }}
          >
            <Tooltip direction="top" offset={[0, -8]} className="map-tooltip marker">
              {dealer.order ? `${dealer.order}. ` : ""}{dealer.name}{isUnclustered ? " (unclustered)" : ""}
            </Tooltip>
          </CircleMarker>
        );
      })}

      {userLocation ? (
        <>
          <CircleMarker
            center={userLocation}
            radius={18}
            pathOptions={{
              color: "#fff4df",
              weight: 1,
              fillColor: "#f3a53d",
              fillOpacity: 0.18,
            }}
            interactive={false}
          />
          <CircleMarker
            center={userLocation}
            radius={8}
            pathOptions={{
              color: "#fff4df",
              weight: 3,
              fillColor: "#f3a53d",
              fillOpacity: 1,
            }}
          >
            <Tooltip direction="top" offset={[0, -8]} className="map-tooltip selected">
              You are here
            </Tooltip>
          </CircleMarker>
        </>
      ) : null}
    </MapContainer>
  );
}
