/**
 * GER-248 — Validadores de servidor compartidos entre funciones Convex.
 *
 * ⚠️ Esto NO va en `emailUtils.ts`: ese módulo está marcado como PURO y sin un
 * solo import porque lo consume también el navegador (ver su cabecera). Aquí sí
 * se importa `ConvexError`, así que este módulo es solo de servidor. La relación
 * va en un único sentido: `validaciones.ts` importa de `emailUtils.ts`, nunca al
 * revés.
 *
 * La forma de estos validadores replica `conceptoValido` / `importeValido` de
 * `convex/ventas.ts`: normalizan, validan y DEVUELVEN el valor ya limpio, para
 * que quien llama no pueda olvidarse de usar la versión normalizada.
 */
import { ConvexError } from "convex/values";
import { normalizarEmail } from "./emailUtils";

// GER-251 — Cotas de longitud para los campos de texto libre que no tenían
// ninguna (salvo `concepto` y `texto`, que ya las traían desde el alta). Los
// valores son los que aprobó Gerardo en el plan de la auditoría; ajustables
// si en uso real resultan molestos, pero no antes.
export const MAX_NOMBRE_CLIENTE = 120;
export const MAX_EMPRESA = 120;
export const MAX_TELEFONO = 40;
export const MAX_EMAIL = 254;
export const MAX_NOTA = 2000;
export const MAX_ACCION = 200;
/** Nombre de una persona del equipo — tres writers reales, ver GER-251. */
export const MAX_NOMBRE_PERSONA = 120;

/**
 * Mismo idioma que `conceptoValido`/`importeValido` de `convex/ventas.ts`: el
 * caller ya hizo `trim()` y comprobó que no esté vacío (cada campo tiene su
 * propio mensaje para eso); esta función solo añade el techo de longitud.
 */
export function assertLongitudMax(valor: string, max: number, etiqueta: string): void {
  if (valor.length > max) {
    throw new ConvexError(`${etiqueta} es demasiado largo (máx. ${max} caracteres)`);
  }
}

/**
 * Normaliza un email opcional y comprueba que diga algo parecido a un correo.
 *
 * Mismo criterio y mismo mensaje que el email de usuario (`usuarios.ts`,
 * `invitar` y `validarActualizacion`): `trim` + minúsculas y `@` obligatoria.
 * No se usa un regex de RFC porque no aporta nada aquí: el correo de un cliente
 * no se usa para autenticar, solo para contactar y para detectar duplicados.
 *
 * Vacío o ausente devuelve `undefined`, que en `clientes` significa "sin email"
 * (un `patch` con `undefined` borra el campo opcional).
 */
export function emailClienteOpcional(email: string | undefined): string | undefined {
  if (email === undefined) return undefined;
  const limpio = normalizarEmail(email);
  if (limpio.length === 0) return undefined;
  if (!limpio.includes("@")) {
    throw new ConvexError("Indica un correo válido");
  }
  assertLongitudMax(limpio, MAX_EMAIL, "El correo");
  return limpio;
}
