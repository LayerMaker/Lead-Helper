import { useEffect } from "react";
import { latLngBounds } from "leaflet";
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";

function toneClass(tone) {
  if (tone === "mint" || tone === "success") return "mint";
  if (tone === "rose" || tone === "warm") return "rose";
  if (tone === "teal") return "teal";
  if (tone === "muted") return "muted";
  return "amber";
}

function FitReportMap({ leafletMap }) {
  const map = useMap();

  useEffect(() => {
    const points = [
      ...(leafletMap?.polygon || []),
      ...(leafletMap?.route || []),
      ...(leafletMap?.points || []).map((point) => point.location),
    ].filter((location) => Array.isArray(location));

    const timer = window.setTimeout(() => {
      map.invalidateSize();
      if (points.length) {
        map.fitBounds(latLngBounds(points), { padding: [28, 28], maxZoom: 14 });
      }
    }, 120);

    return () => window.clearTimeout(timer);
  }, [leafletMap, map]);

  return null;
}

function ReportLeafletMap({ leafletMap, clusterName }) {
  const points = leafletMap?.points || [];
  const polygon = leafletMap?.polygon || [];
  const route = leafletMap?.route || [];
  const colour = leafletMap?.colour || "#f3a53d";
  const center = points[0]?.location || polygon[0] || route[0] || [51.4838, -0.2153];

  if (!points.length && !polygon.length && !route.length) return null;

  return (
    <MapContainer
      center={center}
      zoom={12}
      scrollWheelZoom={false}
      dragging={false}
      touchZoom={false}
      doubleClickZoom={false}
      boxZoom={false}
      keyboard={false}
      zoomControl={false}
      className="report-leaflet-map"
      attributionControl
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitReportMap leafletMap={leafletMap} />

      {polygon.length ? (
        <Polygon
          positions={polygon}
          pathOptions={{
            color: colour,
            weight: 5,
            fillColor: colour,
            fillOpacity: 0.2,
            opacity: 0.98,
            lineJoin: "miter",
          }}
          interactive={false}
        >
          <Tooltip permanent direction="center" className="map-tooltip selected report-cluster-label">
            {clusterName} cluster
          </Tooltip>
        </Polygon>
      ) : null}

      {route.length > 1 ? (
        <>
          <Polyline positions={route} pathOptions={{ color: "#1c140e", weight: 10, opacity: 0.35 }} interactive={false} />
          <Polyline positions={route} pathOptions={{ color: colour, weight: 5, opacity: 0.9, dashArray: "10 10" }} interactive={false} />
        </>
      ) : null}

      {points.map((point) => {
        const pinColour = point.colour || colour;

        return (
          <CircleMarker
            key={point.id}
            center={point.location}
            radius={point.visited ? 9 : 7}
            pathOptions={{
              color: point.visited ? "#fff4df" : pinColour,
              weight: point.visited ? 3 : 2,
              fillColor: pinColour,
              fillOpacity: 0.95,
            }}
            interactive={false}
          >
            <Tooltip permanent direction="top" offset={[0, -8]} className="map-tooltip marker report-pin-label">
              <span className="report-pin-label-text" style={{ color: pinColour }}>
                {point.name}
              </span>
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}

export function ClusterReportTemplate({ report, exportRef = null, mode = "preview" }) {
  if (!report) return null;

  const polygonPoints = report.map.polygon.map(([x, y]) => `${x},${y}`).join(" ");
  const closedPolygonPoints = polygonPoints && report.map.polygon[0] ? `${polygonPoints} ${report.map.polygon[0][0]},${report.map.polygon[0][1]}` : "";
  const routePoints = report.map.route.map(([x, y]) => `${x},${y}`).join(" ");
  const sheetClassName = `report-export-sheet${mode === "print" ? " print-mode" : ""}`;
  const hasLeafletMap = Boolean(report.map.leaflet?.points?.length || report.map.leaflet?.polygon?.length || report.map.leaflet?.route?.length);

  return (
    <article className={sheetClassName} ref={exportRef}>
      <header className="report-export-header">
        <div className="report-export-brand">
          <span className="report-export-mark">LH</span>
          <div>
            <div className="kicker">Cluster report export</div>
            <h2>{report.exportTitle}</h2>
          </div>
        </div>
        <div className="report-export-meta">
          {report.meta.map((item) => (
            <div className="report-meta-pill" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </header>

      <section className="report-export-map-card">
        <div className="report-export-map-head">
          <div>
            <div className="kicker">Territory proof</div>
            <h3>{report.coverageTitle || `${report.clusterName} cluster coverage`}</h3>
            <small>{report.map.sourceLabel}</small>
          </div>
          <span className="pill active">Generated {report.exportDateLabel}</span>
        </div>

        <div className={`report-export-map${hasLeafletMap ? " leaflet" : ""}`}>
          {hasLeafletMap ? (
            <ReportLeafletMap leafletMap={report.map.leaflet} clusterName={report.clusterName} />
          ) : (
            <>
              <div className="report-export-grid"></div>
              <div className="report-export-road road-a"></div>
              <div className="report-export-road road-b"></div>
              <div className="report-export-road road-c"></div>

              <svg className="report-export-svg" viewBox={`0 0 ${report.map.width} ${report.map.height}`} aria-hidden="true">
                {polygonPoints ? <polygon className="report-export-polygon" points={polygonPoints} /> : null}
                {closedPolygonPoints ? <polyline className="report-export-boundary-line" points={closedPolygonPoints} /> : null}
                {routePoints ? <polyline className="report-export-route" points={routePoints} /> : null}
                {report.map.polygon.map(([x, y], index) => (
                  <g key={`boundary-${index}-${x}-${y}`} transform={`translate(${x} ${y})`}>
                    <circle className="report-export-boundary-vertex" r="7" />
                    <circle className="report-export-boundary-vertex-core" r="2.5" />
                  </g>
                ))}
                {report.map.points.map((point) => (
                  <g key={point.id} transform={`translate(${point.x} ${point.y})`}>
                    <circle className={`report-export-node${point.visited ? " visited" : ""}`} r="10" />
                    <circle className="report-export-node-core" r="3.5" />
                  </g>
                ))}
                {report.map.labels.map((label) => (
                  <text key={`${label.text}-${label.x}`} className="report-export-label" x={label.x} y={label.y}>
                    {label.text}
                  </text>
                ))}
              </svg>
            </>
          )}
        </div>
      </section>

      <section className="report-export-stats">
        {report.stats.map((stat) => (
          <div className={`report-stat-card ${toneClass(stat.tone)}`} key={stat.label}>
            <strong>{stat.value}</strong>
            <span>{stat.label}</span>
          </div>
        ))}
      </section>

      <section className="report-export-body">
        <div className="report-export-cards">
          {report.dealershipCards.map((row, index) => (
            <article className={`report-export-dealer-card${index === 0 ? " expanded" : ""}`} key={`${row.id}-${row.visit?.id || "seed"}`}>
              <div className="report-export-dealer-top">
                <div className="report-export-dealer-brand">
                  <span className="dealer-logo-chip" style={{ borderColor: row.reportColour, color: row.reportColour }}>
                    {row.initials}
                  </span>
                  <div>
                    <h3 style={{ color: row.reportColour }}>{row.name}</h3>
                    <small>{row.address}</small>
                  </div>
                </div>
                <span className={`report-status-pill ${toneClass(row.statusTone)}`}>{row.status}</span>
              </div>

              <div className="report-export-dealer-grid">
                <div>
                  <label>Lead score</label>
                  <strong>{row.leadScore}</strong>
                </div>
                <div>
                  <label>Contact captured</label>
                  <strong>{row.contact ? row.contact.name : "No"}</strong>
                </div>
                <div>
                  <label>Email status</label>
                  <strong>{row.emailProof ? row.emailProofHeadline : row.emailProofLabel}</strong>
                </div>
                <div>
                  <label>Next action</label>
                  <strong>{row.nextAction}</strong>
                </div>
              </div>

              <div className="report-export-outcomes">
                {((row.reportOutcomeLabels?.length ? row.reportOutcomeLabels : row.outcomes).length
                  ? row.reportOutcomeLabels?.length
                    ? row.reportOutcomeLabels
                    : row.outcomes
                  : [row.roleHint]
                ).map((outcome) => (
                  <span className="report-outcome-chip" key={outcome}>
                    {outcome}
                  </span>
                ))}
              </div>

              <div className="report-export-note">
                <div>
                  <label>Visit note</label>
                  <p>{row.note || row.pitch || "No visit note added yet."}</p>
                </div>
                <div>
                  <label>Evidence</label>
                  <p>
                    {row.visit ? `Visit logged ${row.visitTime}. ` : ""}
                    {row.contact ? `Contact ${row.contact.name}${row.contact.role ? `, ${row.contact.role}` : ""}. ` : ""}
                    {row.media ? `Media capture recorded. ` : ""}
                    {row.emailProof
                      ? `${row.emailProofDetail} Recorded ${row.emailProofTime}.`
                      : row.draft
                        ? `Email draft ready: ${row.draft.emailType}.`
                        : "No email evidence yet."}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>

        <aside className="report-export-sidebar">
          <section className="report-sidebar-card">
            <div className="kicker">Actions taken</div>
            <ul>
              {report.actionsTaken.map((item) => (
                <li key={`${item.title}-${item.detail}`}>
                  <strong style={{ color: item.colour }}>{item.title}</strong>
                  <span>{item.detail}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="report-sidebar-card">
            <div className="kicker">Evidence generated</div>
            <ul className="report-evidence-list">
              {report.evidenceGenerated.map((item) => (
                <li key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </li>
              ))}
            </ul>
          </section>

          <section className="report-sidebar-card report-sidebar-summary">
            <div className="kicker">Cluster summary</div>
            <p>
              {report.summary.dealershipsVisited} dealerships visited, {report.summary.contactsCaptured} contacts captured,{" "}
              {report.summary.sentFollowUps} follow-ups sent, {report.summary.evidenceCount} total evidence events logged.
            </p>
          </section>
        </aside>
      </section>

      <footer className="report-export-footer">
        <span>Generated by Lead Helper</span>
        <span>{report.exportDateLabel}</span>
      </footer>
    </article>
  );
}
