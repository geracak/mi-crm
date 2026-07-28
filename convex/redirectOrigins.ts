/**
 * GER-238 (reapertura 2026-07-28) — Validación del destino de redirección tras
 * un login con OAuth.
 *
 * ⚠️ El problema que resuelve: el validador por defecto de la librería resuelve
 * cualquier `redirectTo` contra `SITE_URL`, que es un único valor
 * (`@convex-dev/auth/dist/server/implementation/redirects.js:12-23`). Con la app
 * servida en dos dominios —red-24.com y el de Railway—, quien arranca en uno
 * termina con la sesión puesta en el otro y el dominio de origen se queda
 * deslogueado.
 *
 * ⚠️ La comparación es EXACTA por origen. Aceptar un destino arbitrario, o
 * compararlo con `startsWith` sobre un prefijo, sería un open redirect: un
 * enlace que arranca en un dominio nuestro y deposita a la persona autenticada
 * —con su código— en un dominio de terceros. `URL.origin` normaliza esquema,
 * host y puerto, así que no se deja engañar por `red-24.com.atacante.example`
 * ni por credenciales embebidas del tipo `https://red-24.com@atacante.example`.
 *
 * Vive en su propio módulo, sin importar nada de Convex, para poder ejercitarlo
 * de forma aislada: el callback real solo corre dentro del callback de OAuth,
 * que no es alcanzable sin completar un intercambio con el proveedor.
 */

/** Se lanza cuando el destino pedido no está permitido. */
export class DestinoNoPermitido extends Error {}

/**
 * Construye el conjunto de orígenes admitidos. Una entrada mal formada se
 * descarta en lugar de tumbar el login entero: el efecto es fail-closed, ese
 * origen simplemente no queda permitido.
 */
export function origenesPermitidos(
  siteUrl: string | undefined,
  adicionales: string | undefined,
): Set<string> {
  const origenes = new Set<string>();
  for (const crudo of [siteUrl, ...(adicionales ?? "").split(",")]) {
    const limpio = (crudo ?? "").trim();
    if (limpio === "") continue;
    try {
      origenes.add(new URL(limpio).origin);
    } catch {
      // Entrada inválida: se ignora, no se permite.
    }
  }
  return origenes;
}

/**
 * Devuelve la URL absoluta a la que redirigir, o lanza `DestinoNoPermitido`.
 *
 * Un destino relativo se resuelve contra `siteUrl`, igual que hace el default
 * de la librería: es el camino de compatibilidad para cualquier llamada que no
 * mande origen explícito.
 */
export function resolverDestino(
  redirectTo: string,
  siteUrl: string,
  permitidos: Set<string>,
): string {
  // `//host/ruta` es una URL protocol-relative, no una ruta; `/\host` es la
  // misma jugada con contrabarra, que los parsers de esquemas especiales tratan
  // como barra. Concatenarlas a `siteUrl` daría `https://nuestro-host//host/…`,
  // que se queda en nuestro dominio y por tanto no es explotable — pero es el
  // bypass clásico de open redirect y no hay ningún uso legítimo de esas formas
  // acá, así que se rechazan en vez de depender de ese razonamiento.
  if (/^\/[/\\]/.test(redirectTo)) {
    throw new DestinoNoPermitido(
      `Destino protocol-relative no admitido: ${redirectTo}`,
    );
  }
  if (redirectTo.startsWith("/") || redirectTo.startsWith("?")) {
    return `${siteUrl.replace(/\/$/, "")}${redirectTo}`;
  }
  let destino: URL;
  try {
    destino = new URL(redirectTo);
  } catch {
    throw new DestinoNoPermitido(`Destino de redirección inválido: ${redirectTo}`);
  }
  if (!permitidos.has(destino.origin)) {
    throw new DestinoNoPermitido(
      `Origen no permitido: ${destino.origin}. Permitidos: ${[...permitidos].join(", ") || "(ninguno)"}`,
    );
  }
  return redirectTo;
}
