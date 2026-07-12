import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "destructive";
type Size = "default" | "compact";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
}

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-primary text-on-primary font-semibold hover:bg-primary-hover active:bg-primary-active",
  secondary:
    "bg-surface text-text font-medium border-border-strong hover:bg-surface-2",
  ghost: "bg-transparent text-text-muted font-medium hover:bg-surface-2",
  destructive: "bg-error text-white font-semibold hover:brightness-90",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "default",
      loading = false,
      disabled = false,
      iconLeft,
      iconRight,
      className,
      children,
      type = "button",
      ...rest
    },
    ref,
  ) => {
    const isDisabled = disabled || loading;
    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-md border border-transparent px-5 text-[15px] leading-none tracking-tight whitespace-nowrap select-none transition-colors duration-150 [transition-timing-function:var(--ease-standard)]",
          size === "compact" ? "h-11" : "h-12",
          isDisabled
            ? "cursor-not-allowed bg-surface-2 text-text-subtle border-border"
            : cn("cursor-pointer", variantClasses[variant]),
          className,
        )}
        {...rest}
      >
        {loading && (
          <span
            aria-hidden="true"
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
          />
        )}
        {!loading && iconLeft}
        {children}
        {!loading && iconRight}
      </button>
    );
  },
);
Button.displayName = "Button";
