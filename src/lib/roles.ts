import type { BadgeStatus } from "@/components/ui/Badge";

/**
 * Los dos roles del negocio (PRD F18). Ojo: los diseños del área de
 * administración amplia (GER-59..63) hablan de "Administrador"/"Agente" — esos
 * NO son estos y no forman parte del MVP.
 */
export type Rol = "propietaria" | "comercial";

/** Cómo se llaman de cara a la gente. En el código siempre el valor interno. */
export const ROL_LABEL: Record<Rol, string> = {
  propietaria: "Dueña",
  comercial: "Atiende y vende",
};

/** Para el `ChipGroup` de los overlays de alta y edición. */
export const ROLES: { value: Rol; label: string }[] = [
  { value: "propietaria", label: ROL_LABEL.propietaria },
  { value: "comercial", label: ROL_LABEL.comercial },
];

export const ROL_BADGE: Record<Rol, BadgeStatus> = {
  propietaria: "primary",
  comercial: "neutral",
};
