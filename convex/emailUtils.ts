/**
 * GER-239 — Piezas compartidas entre el servidor y el cliente para el flujo de
 * recuperación de contraseña.
 *
 * ⚠️ MÓDULO PURO: no debe tener NI UN import, ni de Convex, ni de `process.env`,
 * ni de nada. Lo consumen las tres capas que tienen que coincidir carácter a
 * carácter — el cliente (`src/app/(auth)/login/page.tsx`), el `profile()` de
 * `convex/auth.ts` y el `authorize` de `convex/ResendOTP.ts`. Si adquiriera una
 * dependencia de servidor, rompería el bundle del navegador; por eso la marca
 * `ENVIO_FALLIDO` vive aquí y no en `ResendOTP.ts`, que sí importa cosas de
 * servidor.
 *
 * Por qué hacen falta las tres: `@convex-dev/auth` compara
 * `account.providerAccountId !== params.email` usando los params ORIGINALES
 * (`providers/Email.ts:44-55`), que `Password.ts` pasa sin tocar a
 * `signInViaProvider`. Normalizar solo en `profile()` encontraría la cuenta y
 * luego fallaría al verificar el código.
 */
export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Marca que distingue "no pudimos enviar el correo" de cualquier otro fallo del
 * flujo de reset. La interfaz necesita separarlos: un correo inexistente debe
 * mostrar el mensaje NEUTRO (para no revelar qué cuentas existen), pero un
 * fallo real de envío tiene que verse como error — si no, diríamos que mandamos
 * un código que nunca salió. Viaja dentro de un `ConvexError`, cuyo `data` sí
 * llega al cliente; un `Error` normal llegaría como "Server Error" genérico.
 */
export const ENVIO_FALLIDO = "ENVIO_FALLIDO";
