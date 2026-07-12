import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title?: string;
  help?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, help, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      {icon && (
        <span
          aria-hidden="true"
          className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-surface-2 text-text-muted"
        >
          {icon}
        </span>
      )}
      {title && <h4 className="m-0 text-[15px] font-semibold text-text">{title}</h4>}
      {help && <p className="m-0 max-w-[280px] text-[13px] text-text-muted">{help}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
