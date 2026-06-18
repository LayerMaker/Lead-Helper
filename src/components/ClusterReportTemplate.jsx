function toneClass(tone) {
  if (tone === "mint" || tone === "success") return "mint";
  if (tone === "rose" || tone === "warm") return "rose";
  if (tone === "teal") return "teal";
  if (tone === "muted") return "muted";
  return "amber";
}

export function ClusterReportTemplate({ report, exportRef = null, mode = "preview" }) {
  if (!report) return null;

  const polygonPoints = report.map.polygon.map(([x, y]) => `${x},${y}`).join(" ");
  const routePoints = report.map.route.map(([x, y]) => `${x},${y}`).join(" ");
  const sheetClassName = `report-export-sheet${mode === "print" ? " print-mode" : ""}`;

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
            <h3>{report.clusterName} cluster coverage</h3>
          </div>
          <span className="pill active">Generated {report.exportDateLabel}</span>
        </div>

        <div className="report-export-map">
          <div className="report-export-grid"></div>
          <div className="report-export-road road-a"></div>
          <div className="report-export-road road-b"></div>
          <div className="report-export-road road-c"></div>

          <svg className="report-export-svg" viewBox={`0 0 ${report.map.width} ${report.map.height}`} aria-hidden="true">
            {polygonPoints ? <polygon className="report-export-polygon" points={polygonPoints} /> : null}
            {routePoints ? <polyline className="report-export-route" points={routePoints} /> : null}
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
                  <span className="dealer-logo-chip">{row.initials}</span>
                  <div>
                    <h3>{row.name}</h3>
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
                  <strong>{row.sentEmail ? "Sent" : row.draft ? "Draft ready" : "Not started"}</strong>
                </div>
                <div>
                  <label>Next action</label>
                  <strong>{row.nextAction}</strong>
                </div>
              </div>

              <div className="report-export-outcomes">
                {(row.outcomes.length ? row.outcomes : [row.roleHint]).map((outcome) => (
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
                    {row.draft ? `Email ${row.draft.status}.` : "No email evidence yet."}
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
                  <strong>{item.title}</strong>
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
