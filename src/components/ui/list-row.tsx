import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/cn";

interface ListRowProps {
  name: string;
  subtitle?: string;
  amount?: ReactNode;
  badge?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  leading?: ReactNode;
  trailing?: ReactNode;
}

export function ListRow({
  name,
  subtitle,
  amount,
  badge,
  selected = false,
  onClick,
  leading,
  trailing,
}: ListRowProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 px-[18px] py-3.5 transition-colors duration-150 [transition-timing-function:var(--ease-standard)]",
        selected ? "bg-surface-2" : "hover:bg-surface-2",
        onClick ? "cursor-pointer" : "cursor-default",
      )}
    >
      {leading ?? <Avatar name={name} size={40} />}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[15px] font-medium text-text">{name}</span>
        {subtitle && <span className="truncate text-[13px] text-text-muted">{subtitle}</span>}
      </div>
      {badge}
      {trailing}
      {amount != null && (
        <span className="whitespace-nowrap text-right font-mono text-[15px] tabular-nums text-text">
          {amount}
        </span>
      )}
    </div>
  );
}
