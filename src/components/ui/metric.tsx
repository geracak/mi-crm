interface MetricProps {
  label: string;
  value: string;
  delta?: string;
  deltaDirection?: "up" | "down";
}

export function Metric({ label, value, delta, deltaDirection }: MetricProps) {
  let dir = deltaDirection;
  if (!dir && delta) {
    dir = delta.trim().startsWith("-") ? "down" : "up";
  }
  const isUp = dir !== "down";

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] tracking-tight text-text-muted">{label}</span>
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[30px] leading-[1.1] font-medium tabular-nums text-text">
          {value}
        </span>
        {delta && (
          <span
            className={
              "inline-flex items-center gap-1 rounded-full px-2 py-[3px] font-mono text-xs font-medium tabular-nums " +
              (isUp ? "bg-success-bg text-success-text" : "bg-error-bg text-error-text")
            }
          >
            {isUp ? "▲" : "▼"} {delta.replace(/^[+-]/, "")}
          </span>
        )}
      </div>
    </div>
  );
}
