import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode;
  action?: ReactNode;
  onAction?: () => void;
}

export function Card({
  title,
  action,
  onAction,
  children,
  className,
  ...rest
}: CardProps) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-surface p-5 shadow-xs",
        className,
      )}
      {...rest}
    >
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && (
            <h3 className="m-0 text-[15px] font-semibold tracking-tight text-text">
              {title}
            </h3>
          )}
          {action && (
            <button
              type="button"
              onClick={onAction}
              className="cursor-pointer border-none bg-transparent p-0 text-sm font-medium text-primary"
            >
              {action}
            </button>
          )}
        </header>
      )}
      {children}
    </section>
  );
}
