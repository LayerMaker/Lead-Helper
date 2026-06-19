import { CircleMarker, MapContainer, Polygon, TileLayer, Tooltip, useMap } from "react-leaflet";
import { latLngBounds } from "leaflet";
import { useEffect, useMemo } from "react";

const discoveryPalette = ["#f3a53d", "#7ae3b8", "#ff7fa7", "#2fd4d4", "#b8de6f", "#d8a7ff"];

function buildAreaColorMap(areas) {
  return Object.fromEntries(areas.map((area, index) => [area.id, discoveryPalette[index % discoveryPalette.length]]));
}

function FitToDiscovery({ areas, selectedArea, selectedProspects, manualDealerships, userLocation }) {
  const map = useMap();

  useEffect(() => {
    const points = selectedArea
      ? [...selectedArea.polygon, ...selectedProspects.map((prospect) => prospect.location).filter(Boolean)]
      : [
          ...areas.flatMap((area) => area.polygon),
          ...areas.map((area) => area.center).filter(Boolean),
        ];
    points.push(...manualDealerships.map((dealership) => dealership.location).filter(Boolean));
    if (userLocation) points.push(userLocation);
    if (!points.length) return;
    map.fitBounds(latLngBounds(points), { padding: [32, 32], maxZoom: selectedArea ? 14 : 11 });
  }, [areas, manualDealerships, map, selectedArea, selectedProspects, userLocation]);

  return null;
}

export function DiscoveryMap({
  areas,
  prospects,
  selectedArea,
  selectedProspects,
  selectedProspectId,
  onSelectArea,
  onSelectProspect,
  manualDealerships = [],
  selectedManualDealershipId = null,
  onSelectManualDealership = () => {},
  userLocation,
  parkedAreaIds = [],
  promotedAreaIds = [],
}) {
  const areaColors = useMemo(() => buildAreaColorMap(areas), [areas]);
  const mapCenter = selectedArea?.center || areas[0]?.center || [51.49, -0.21];
  const parkedSet = useMemo(() => new Set(parkedAreaIds), [parkedAreaIds]);
  const promotedSet = useMemo(() => new Set(promotedAreaIds), [promotedAreaIds]);

  return (
    <MapContainer center={mapCenter} zoom={11} scrollWheelZoom className="field-map" attributionControl>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitToDiscovery
        areas={areas}
        selectedArea={selectedArea}
        selectedProspects={selectedProspects}
        manualDealerships={manualDealerships}
        userLocation={userLocation}
      />

      {areas.map((area) => {
        const isSelected = area.id === selectedArea?.id;
        const color = areaColors[area.id];
        const isParked = parkedSet.has(area.id);
        const isPromoted = promotedSet.has(area.id);
        if (!area.polygon.length) return null;

        return (
          <Polygon
            key={area.id}
            positions={area.polygon}
            pathOptions={{
              color,
              weight: isSelected ? 4 : isPromoted ? 3 : 2,
              fillColor: color,
              fillOpacity: isSelected ? 0.22 : isParked ? 0.03 : isPromoted ? 0.12 : 0.08,
              opacity: isSelected ? 0.95 : isParked ? 0.25 : isPromoted ? 0.72 : 0.5,
              dashArray: isParked ? "8 8" : undefined,
            }}
            eventHandlers={{
              click: () => onSelectArea(area.id),
            }}
          >
            <Tooltip sticky direction="center" className={`map-tooltip ${isSelected ? "selected" : ""}`}>
              {area.name}
            </Tooltip>
          </Polygon>
        );
      })}

      {prospects.map((prospect) => {
        const areaId = areas.find((area) => area.name === prospect.searchOrigin)?.id;
        const color = areaColors[areaId] || "#f3a53d";
        const isSelectedArea = !selectedArea || areaId === selectedArea.id;
        const isCurrent = prospect.id === selectedProspectId;
        const radius = isCurrent ? 9 : Math.max(5, Math.min(8, 4 + Math.round((prospect.fitScore || 0) / 4)));

        return (
          <CircleMarker
            key={prospect.id}
            center={prospect.location}
            radius={radius}
            pathOptions={{
              color: isCurrent ? "#fff4df" : color,
              weight: isCurrent ? 3 : 2,
              fillColor: color,
              fillOpacity: isSelectedArea ? 0.92 : 0.36,
              opacity: isSelectedArea ? 1 : 0.5,
            }}
            eventHandlers={{
              click: () => {
                if (areaId) onSelectArea(areaId);
                onSelectProspect(prospect.id);
              },
            }}
          >
            <Tooltip direction="top" offset={[0, -8]} className="map-tooltip marker">
              {prospect.name}
            </Tooltip>
          </CircleMarker>
        );
      })}

      {manualDealerships.map((dealership) => {
        if (!Array.isArray(dealership.location)) return null;
        const isCurrent = dealership.id === selectedManualDealershipId;
        const isAssigned = Boolean(dealership.clusterId);

        return (
          <CircleMarker
            key={dealership.id}
            center={dealership.location}
            radius={isCurrent ? 10 : 7}
            pathOptions={{
              color: isCurrent ? "#fff4df" : isAssigned ? "#7ae3b8" : "#f7c66f",
              weight: isCurrent ? 3 : 2,
              fillColor: isAssigned ? "#2fd4d4" : "#f3a53d",
              fillOpacity: isAssigned ? 0.76 : 0.95,
              opacity: 1,
              dashArray: isAssigned ? undefined : "5 5",
            }}
            eventHandlers={{
              click: () => onSelectManualDealership(dealership.id),
            }}
          >
            <Tooltip direction="top" offset={[0, -8]} className={`map-tooltip marker ${isCurrent ? "selected" : ""}`}>
              {dealership.name} {isAssigned ? "" : "(unclustered)"}
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
