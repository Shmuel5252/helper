export default function QuietMark({ compact = false }: { compact?: boolean }) {
  return <div aria-hidden="true" className={`quiet-mark ${compact ? 'quiet-mark-small' : ''}`}>
    <svg viewBox="0 0 160 160" fill="none">
      <circle cx="80" cy="80" r="55" className="quiet-mark-orbit" />
      <ellipse cx="80" cy="80" rx="55" ry="25" transform="rotate(-35 80 80)" />
      <ellipse cx="80" cy="80" rx="55" ry="25" transform="rotate(35 80 80)" />
      <ellipse cx="80" cy="80" rx="25" ry="55" />
      <circle cx="80" cy="80" r="4" className="quiet-mark-core" />
    </svg>
  </div>;
}
