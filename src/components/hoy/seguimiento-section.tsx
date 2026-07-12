import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

interface SeguimientoSectionProps {
  title: string;
  count: number;
  variant?: "error" | "default";
  children: ReactNode;
}

export function SeguimientoSection({
  title,
  count,
  variant = "default",
  children,
}: SeguimientoSectionProps) {
  if (count === 0) return null;

  return (
    <Card
      className={cn(variant === "error" && "border-error-bg bg-error-bg/40")}
      title={
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              "h-2 w-2 rounded-full",
              variant === "error" ? "bg-error" : "bg-primary",
            )}
          />
          {title} ({count})
        </span>
      }
    >
      <div className="-mx-5 -mb-5 divide-y divide-border">{children}</div>
    </Card>
  );
}
