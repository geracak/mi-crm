import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "destructive";
type Size = "default" | "compact";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
  "aria-label": string;
}

const variantClasses: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  secondary: "bg-surface text-text border border-border-strong hover:bg-surface-2",
  ghost: "bg-transparent text-text-muted hover:bg-surface-2",
  destructive: "bg-error text-white hover:brightness-90",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    { variant = "ghost", size = "default", disabled, className, children, ...rest },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center rounded-md border border-transparent transition-colors duration-150 [transition-timing-function:var(--ease-standard)]",
          size === "compact" ? "h-11 w-11" : "h-12 w-12",
          disabled
            ? "cursor-not-allowed bg-surface-2 text-text-subtle"
            : cn("cursor-pointer", variantClasses[variant]),
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
IconButton.displayName = "IconButton";
