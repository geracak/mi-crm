"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

interface ChipOption<T extends string> {
  value: T;
  label: string;
}

interface ChipGroupProps<T extends string> {
  label?: string;
  options: ReadonlyArray<ChipOption<T>>;
  value: T | null;
  onChange: (value: T | null) => void;
  /**
   * Opciones que se ven pero no se pueden elegir (p. ej. bajarle el rol a la
   * única dueña). Omitirlo deja el componente exactamente como estaba.
   */
  disabledValues?: ReadonlyArray<T>;
}

/**
 * Grupo de chips de selección única y opcional: al pulsar el chip activo se
 * deselecciona (`onChange(null)`). Presentacional; sigue los tokens del design
 * system (chip activo en `primary`, inactivo en superficie con borde fuerte).
 * Toggle buttons con `aria-pressed` dentro de un `role="group"` etiquetado.
 *
 * Los chips deshabilitados conservan su `aria-pressed`: siguen siendo un
 * control de selección y hay que poder saber si están elegidos o no —
 * `aria-disabled` dice que no se puede tocar, no reemplaza ese estado.
 */
export function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  disabledValues,
}: ChipGroupProps<T>) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-2">
      {label && (
        <span id={labelId} className="text-[14px] font-medium text-text">
          {label}
        </span>
      )}
      <div
        role="group"
        aria-labelledby={label ? labelId : undefined}
        className="flex flex-wrap gap-2"
      >
        {options.map((o) => {
          const selected = value === o.value;
          const disabled = disabledValues?.includes(o.value) ?? false;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={selected}
              aria-disabled={disabled || undefined}
              disabled={disabled}
              onClick={
                disabled ? undefined : () => onChange(selected ? null : o.value)
              }
              className={cn(
                "rounded-md px-[14px] py-[9px] text-[14px] font-medium transition-colors duration-150 ease-[var(--ease-standard)]",
                selected
                  ? "border border-primary bg-primary-subtle text-primary"
                  : "border border-border-strong bg-surface text-text-muted",
                disabled
                  ? "cursor-not-allowed opacity-50"
                  : !selected && "hover:bg-surface-2",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
