import { cn } from "@/lib/cn";

interface AvatarProps {
  name?: string;
  initials?: string;
  size?: number;
  variant?: "primary" | "neutral";
  className?: string;
}

export function Avatar({
  name = "",
  initials,
  size = 40,
  variant = "primary",
  className,
}: AvatarProps) {
  const text =
    initials ||
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();

  return (
    <span
      aria-label={name || undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-tight",
        variant === "neutral"
          ? "bg-surface-2 text-text-muted"
          : "bg-primary-subtle text-primary",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.35),
      }}
    >
      {text}
    </span>
  );
}
