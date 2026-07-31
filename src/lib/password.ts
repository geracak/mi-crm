/**
 * Longitud mínima de la contraseña, para avisar ANTES de enviar el formulario.
 *
 * ⚠️ Esto es UX, no es el control. La autoridad está en el servidor: el mismo
 * número vive en `convex/usuarios.ts` (`MIN_PASSWORD`) y ahí es donde se
 * rechaza de verdad — entre otras cosas porque
 * `modifyAccountCredentials` no valida longitud por su cuenta. Si cambia uno,
 * cambiar el otro.
 *
 * Se comprueba siempre en JS y NUNCA con `minLength` en el input: el atributo
 * hace que el navegador bloquee el envío antes y muestre su propio aviso, en el
 * idioma del navegador (inglés para la mayoría) y sin los estilos de la app.
 */
export const MIN_PASSWORD = 8;
