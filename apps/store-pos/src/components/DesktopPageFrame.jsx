export default function DesktopPageFrame({
  title,
  description,
  kpis = [],
  actions = null,
  filters = null,
  children
}) {
  return (
    <section className="content-page page-container">
      <div className="page-header">
        <div>
          <h1>{title}</h1>
          {description ? <p className="stat-text">{description}</p> : null}
        </div>
        {actions ? <div className="action-row">{actions}</div> : null}
      </div>

      {kpis.length ? (
        <div className="summary-grid">
          {kpis.map((item) => (
            <div key={item.label} className="summary-item">
              <div className="summary-label">{item.label}</div>
              <div className={`summary-value ${item.mono ? "mono" : ""}`}>{item.value}</div>
            </div>
          ))}
        </div>
      ) : null}

      {filters ? <div className="search-section">{filters}</div> : null}

      <div className="desktop-data-zone">
        {children}
      </div>
    </section>
  );
}
