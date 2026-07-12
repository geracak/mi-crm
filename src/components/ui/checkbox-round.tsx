import { cn } from "@/lib/cn";

interface CheckboxRoundProps {
  checked: boolean;
  onChange: () => void;
  "aria-label": string;
}

// No existe como componente propio en el design system de referencia (solo
// se menciona en README como "checkbox redondo 22-24px"); construido a spec.
export function CheckboxRound({ checked, onChange, ...rest }: CheckboxRoundProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onChange();
        }
      }}
      className={cn(
        "flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors duration-150 [transition-timing-function:var(--ease-standard)]",
        checked ? "border-primary bg-primary" : "border-border-strong bg-surface hover:border-primary",
      )}
      {...rest}
    >
      {checked && (
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
    </button>
  );
}
