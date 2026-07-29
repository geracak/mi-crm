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

/**
 * GER-242 — Cuánto vale un código de 8 dígitos, según para qué es.
 *
 * Viven aquí, en el módulo puro, porque los consumen cuatro sitios que TIENEN
 * que coincidir: el texto del correo (`ResendOTP.ts`), el control que decide si
 * un código sigue sirviendo (`convex/auth.ts`), el estado que ve el login
 * (`convex/usuarios.ts::estadoCuenta`) y el texto de la pantalla
 * (`src/app/(auth)/login/page.tsx`). Un número distinto en cualquiera de ellos
 * es una mentira hacia la persona o un agujero hacia adentro.
 *
 * ⚠️ La INVITACIÓN dura mucho porque nadie abre el correo al instante, y un
 * "código vencido" sería lo primero que ve del producto. La RECUPERACIÓN dura
 * poco porque ahí hay una contraseña vigente que proteger y quien la pide está
 * delante de la pantalla.
 */
export const VENTANA_INVITACION_MS = 24 * 60 * 60 * 1000;
export const VENTANA_RECUPERACION_MS = 15 * 60 * 1000;

/** Cómo se dicen esas ventanas de cara a la gente. Mismo motivo: no derivar. */
export const ETIQUETA_VENTANA_INVITACION = "24 horas";
export const ETIQUETA_VENTANA_RECUPERACION = "15 minutos";

/**
 * La ventana que le toca a un código, derivada del estado de la cuenta.
 *
 * ⚠️ Es una FUNCIÓN de `passwordPendiente` y nada más. No lee ni escribe
 * estado propio, y por eso no puede quedar desincronizada del código al que
 * describe — que es exactamente el fallo que tenía `users.codigoVenceEn`, un
 * espejo guardado en otra transacción que podía divergir del código real.
 */
export function ventanaCodigoMs(passwordPendiente: boolean): number {
  return passwordPendiente ? VENTANA_INVITACION_MS : VENTANA_RECUPERACION_MS;
}
