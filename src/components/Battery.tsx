import { pct } from "../progress";

// Topbar progress meter drawn as a battery: label on the left, then a cell
// filled to done/total with the count printed inside. `empty` keeps the
// cell blank while the real total isn't known yet.
export function Battery({
  label,
  done,
  total,
  tone,
  pending = false,
}: {
  label: string;
  done: number;
  total: number;
  tone: "accent" | "ok";
  pending?: boolean;
}) {
  const percent = pending ? 0 : pct({ correct: done, total });
  const text = `${done}/${total}`;
  return (
    <div
      className={`battery ${tone}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pending ? undefined : percent}
      aria-valuetext={pending ? undefined : `${text} (${percent}%)`}
      title={pending ? label : `${label}: ${text} (${percent}%)`}
    >
      <span className="battery-label">{label}</span>
      <span className="battery-cell">
        {/* any progress shows a sliver, so 1 of 145 doesn't read as empty */}
        <span
          className="battery-fill"
          style={{
            width: `${percent}%`,
            minWidth: !pending && done > 0 ? 3 : 0,
          }}
        />
        {!pending && <strong className="battery-value">{text}</strong>}
      </span>
    </div>
  );
}
