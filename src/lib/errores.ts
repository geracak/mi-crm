import { ConvexError } from "convex/values";

/**
 * Lo que puede viajar en un `ConvexError` de este proyecto. El backend lanza:
 *
 *   ConvexError("texto para la persona")                    ← forma histórica
 *   ConvexError({ mensaje, codigo? })                        ← forma con código
 *
 * El `codigo` existe para que la pantalla pueda reaccionar a un caso concreto
 * sin comparar textos (que cambian con cualquier retoque de redacción).
 */
type DatosError = { mensaje: string; codigo?: string };

function datosDe(e: unknown): DatosError | null {
  if (!(e instanceof ConvexError)) return null;
  if (typeof e.data === "string") return { mensaje: e.data };
  const d = e.data as Partial<DatosError> | null;
  if (typeof d === "object" && d !== null && typeof d.mensaje === "string") {
    return { mensaje: d.mensaje, codigo: d.codigo };
  }
  return null;
}

/**
 * Mensaje legible de un error de Convex. Cualquier otra cosa (fallo de red,
 * error interno) usa `fallback`: nunca se enseña un stack ni el prefijo
 * "[CONVEX ...]" que trae `String(error)`.
 */
export function mensajeError(e: unknown, fallback: string): string {
  return datosDe(e)?.mensaje ?? fallback;
}

/** Código estable del error, si el backend lo mandó. `null` si no. */
export function codigoError(e: unknown): string | null {
  return datosDe(e)?.codigo ?? null;
}
