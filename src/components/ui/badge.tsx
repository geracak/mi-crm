import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Status = "success" | "warning" | "error" | "info" | "primary" | "neutral";

const statusClasses: Record<Status, { bg: string; text: string; dot: string }> = {
  success: { bg: "bg-success-bg", text: "text-success-text", dot: "bg-success" },
  warning: { bg: "bg-warning-bg", text: "text-warning-text", dot: "bg-warning" },
  error: { bg: "bg-error-bg", text: "text-error-text", dot: "bg-error" },
  info: { bg: "bg-info-bg", text: "text-info-text", dot: "bg-info" },
  primary: { bg: "bg-primary-subtle", text: "text-primary", dot: "bg-primary" },
  neutral: { bg: "bg-surface-2", text: "text-text-muted", dot: "bg-text-muted" },
};

interface BadgeProps {
  children: ReactNode;
  status?: Status;
  dot?: boolean;
  className?: string;
}

export function Badge({ children, status = "neutral", dot = true, className }: BadgeProps) {
  const s = statusClasses[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-[5px] text-[13px] font-medium tracking-tight",
        s.bg,
        s.text,
        status === "neutral" && "border border-border",
        className,
      )}
    >
      {dot && (
        <span aria-hidden="true" className={cn("h-[7px] w-[7px] shrink-0 rounded-full", s.dot)} />
      )}
      {children}
    </span>
  );
}
