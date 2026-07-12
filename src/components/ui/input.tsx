import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  icon?: ReactNode;
  error?: string | null;
  helper?: string | null;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, icon, error, helper, id, className, disabled, ...rest }, ref) => {
    const [focus, setFocus] = useState(false);
    const generatedId = useId();
    const inputId = id || generatedId;

    const borderClass = error
      ? "border-error"
      : focus
        ? "border-primary"
        : "border-border-strong";
    const ringClass = error
      ? "ring-2 ring-error-bg"
      : focus
        ? "ring-2 ring-primary-subtle"
        : "";

    return (
      <div className="flex flex-col gap-2">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium tracking-tight text-text">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {icon && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 inline-flex text-text-subtle"
            >
              {icon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            disabled={disabled}
            onFocus={(e) => {
              setFocus(true);
              rest.onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocus(false);
              rest.onBlur?.(e);
            }}
            className={cn(
              "h-12 w-full rounded-md border text-[15px] tracking-tight text-text outline-none transition-[border-color,box-shadow] duration-150 [transition-timing-function:var(--ease-standard)]",
              icon ? "pl-10 pr-3.5" : "px-3.5",
              disabled ? "cursor-not-allowed bg-surface-2" : "bg-surface",
              borderClass,
              ringClass,
              className,
            )}
            {...rest}
          />
        </div>
        {error && <span className="flex items-center gap-1.5 text-[13px] text-error-text">{error}</span>}
        {!error && helper && <span className="text-[13px] text-text-muted">{helper}</span>}
      </div>
    );
  },
);
Input.displayName = "Input";
