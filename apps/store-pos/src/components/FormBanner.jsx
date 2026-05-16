export default function FormBanner({ message = "", tone = "error", style, className = "" }) {
  if (!message) return null;

  const toneClass = tone === "success" ? "form-banner--success" : "form-banner--error";
  return (
    <div className={`form-banner ${toneClass} ${className}`.trim()} style={style}>
      {message}
    </div>
  );
}
