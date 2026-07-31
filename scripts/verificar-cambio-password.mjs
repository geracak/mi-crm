/**
 * GER-218 — Test negativo permanente del cambio de contraseña propio.
 *
 * Comprueba, contra el deployment de DESARROLLO y de punta a punta, las cuatro
 * invariantes que sostiene `usuarios:cambiarPassword`:
 *
 *   1. Una contraseña actual incorrecta se rechaza con el código
 *      PASSWORD_ACTUAL_INCORRECTA, no cambia nada y NO revoca ninguna sesión
 *      (control negativo del ORDEN: verificar va antes de revocar; si no,
 *      teclear mal sería una forma trivial de echar a alguien de sus otros
 *      dispositivos).
 *   2. Una contraseña nueva por debajo del mínimo se rechaza EN EL SERVIDOR,
 *      saltándose la interfaz. Es la única validación que existe en esta ruta:
 *      `modifyAccountCredentials` no valida longitud, solo hashea.
 *   3. Camino feliz: la contraseña cambia, la sesión desde la que se hizo el
 *      cambio sigue viva y las DEMÁS quedan revocadas.
 *   4. Después del cambio, la contraseña vieja ya no entra y la nueva sí.
 *
 * ⚠️ Qué se mide como "sesión revocada": que su REFRESH TOKEN ya no sirva. El
 * access token que ese dispositivo tuviera en la mano es un JWT sin estado y
 * sigue valiendo hasta caducar (1 h por defecto,
 * `@convex-dev/auth/dist/server/implementation/tokens.js:4`), porque
 * `ctx.auth.getUserIdentity()` verifica la firma y no consulta `authSessions`.
 * Medir por el refresh es lo único que distingue "revocada" de "todavía no
 * caducada", y es la promesa que de verdad hace el producto.
 *
 * ⚠️ SOLO CONTRA DESARROLLO. La puerta es fail-closed: aborta antes de abrir el
 * cliente si `CONVEX_DEPLOYMENT` no es `dev:`, o si `NEXT_PUBLIC_CONVEX_URL` no
 * coincide carácter a carácter con la URL derivada de ese deployment (mismo
 * criterio que `scripts/repro-a1.mjs`, hallazgo M1 de GER-240: una sola
 * autoridad, la URL se DERIVA y la publicada se degrada a aserción).
 *
 * La cuenta usada es la sacrificable (`carlos@vibecrm.local`) y el script
 * DEVUELVE su contraseña al valor de partida al terminar, pase lo que pase.
 *
 * Código de salida: 0 = todas las invariantes se sostienen · 1 = alguna falló.
 *
 * Uso:
 *   VERIF_PASSWORD="la contraseña actual de carlos en dev" \
 *     node scripts/verificar-cambio-password.mjs
 *
 * La contraseña va por variable de entorno y no por `argv`: en la línea de
 * comandos quedaría visible para cualquier proceso que liste la tabla.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const signIn = makeFunctionReference("auth:signIn");
const actual = makeFunctionReference("usuarios:actual");
const cambiarPassword = makeFunctionReference("usuarios:cambiarPassword");

const EMAIL = "carlos@vibecrm.local";
const RAIZ = fileURLToPath(new URL("..", import.meta.url));

/**
 * Contraseñas de trabajo. La nueva es ALEATORIA en cada corrida — no un valor
 * fijo escrito en el script — para que dos corridas no puedan pisarse (dos
 * `verificar` en paralelo, o una corrida anterior que no llegó a restaurar) y
 * para no dejar una credencial adivinable si la restauración fallara.
 */
const PASSWORD_NUEVA = `GER218-temporal-${randomUUID()}`;
const PASSWORD_CORTA = "1234567"; // 7 caracteres: uno menos que el mínimo
const PASSWORD_MAL = "esta-no-es-la-contrasena-000";

function abortar(motivo) {
  console.error(`ABORTADO: ${motivo}`);
  process.exit(1);
}

/** Lee un dotenv con las mismas reglas que el CLI de Convex (ver repro-a1). */
function leerArchivoEnv(ruta) {
  let texto;
  try {
    texto = readFileSync(ruta, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return {};
    throw err;
  }
  const vars = {};
  for (const linea of texto.split("\n")) {
    const limpia = linea.trim();
    if (limpia === "" || limpia.startsWith("#")) continue;
    const corte = limpia.indexOf("=");
    if (corte === -1) continue;
    let valor = limpia.slice(corte + 1).trim();
    const comilla = valor[0];
    if (comilla === '"' || comilla === "'") {
      const cierre = valor.indexOf(comilla, 1);
      valor = cierre === -1 ? valor.slice(1) : valor.slice(1, cierre);
    } else {
      valor = valor.split(/\s+#/)[0].trim();
    }
    vars[limpia.slice(0, corte).trim()] = valor;
  }
  return vars;
}

/** Puerta de entorno fail-closed: una sola autoridad, `CONVEX_DEPLOYMENT`. */
function resolverDeploymentDev() {
  const env = leerArchivoEnv(join(RAIZ, ".env.local"));
  const declarado = process.env.CONVEX_DEPLOYMENT ?? env.CONVEX_DEPLOYMENT ?? "";
  if (declarado === "") {
    abortar("no hay CONVEX_DEPLOYMENT ni en el proceso ni en .env.local.");
  }
  const separador = declarado.indexOf(":");
  const tipo = separador === -1 ? "" : declarado.slice(0, separador);
  const nombre = separador === -1 ? "" : declarado.slice(separador + 1);
  if (tipo !== "dev") {
    abortar(
      `CONVEX_DEPLOYMENT no es de desarrollo (vale "${declarado}"). ` +
        "Este script no se corre nunca contra producción.",
    );
  }
  if (!/^[a-z0-9-]+$/.test(nombre)) {
    abortar(`el nombre del deployment ("${nombre}") no tiene la forma esperada.`);
  }
  const url = `https://${nombre}.convex.cloud`;
  const publicada =
    process.env.NEXT_PUBLIC_CONVEX_URL ?? env.NEXT_PUBLIC_CONVEX_URL ?? "";
  if (publicada !== "" && publicada !== url) {
    abortar(
      `NEXT_PUBLIC_CONVEX_URL ("${publicada}") no coincide con la URL derivada ` +
        `de CONVEX_DEPLOYMENT ("${url}"). Entorno inconsistente.`,
    );
  }
  return { nombre, url };
}

const destino = resolverDeploymentDev();
const PASSWORD_ORIGINAL = process.env.VERIF_PASSWORD ?? "";
if (PASSWORD_ORIGINAL === "") {
  abortar("falta VERIF_PASSWORD (la contraseña actual de carlos en dev).");
}

function nuevoCliente() {
  return new ConvexHttpClient(destino.url);
}

/** Entra con contraseña y devuelve los tokens, o el error. */
async function entrar(password) {
  try {
    const r = await nuevoCliente().action(signIn, {
      provider: "password",
      params: { email: EMAIL, password, flow: "signIn" },
    });
    return { ok: true, tokens: r?.tokens ?? null, error: null };
  } catch (error) {
    return { ok: false, tokens: null, error };
  }
}

/** Cliente ya autenticado con un access token concreto. */
function comoSesion(tokens) {
  const c = nuevoCliente();
  c.setAuth(tokens.token);
  return c;
}

/** ¿Ese refresh token sigue sirviendo? Es el oráculo de "sesión viva". */
async function refrescaTodavia(tokens) {
  try {
    const r = await nuevoCliente().action(signIn, {
      refreshToken: tokens.refreshToken,
    });
    return r?.tokens != null;
  } catch {
    return false;
  }
}

function datosDelError(error) {
  const d = error?.data;
  if (typeof d === "string") return { mensaje: d, codigo: undefined };
  if (d && typeof d === "object") return { mensaje: d.mensaje, codigo: d.codigo };
  return { mensaje: String(error?.message ?? error), codigo: undefined };
}

async function cambiar(sesion, passwordActual, passwordNueva) {
  try {
    await sesion.action(cambiarPassword, { passwordActual, passwordNueva });
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error };
  }
}

// --- Ejecución -------------------------------------------------------------

const fallos = [];
function comprobar(nombre, condicion, detalle) {
  console.log(`${condicion ? "  OK  " : " FALLO"}  ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  if (!condicion) fallos.push(nombre);
}

console.log(`Deployment: ${destino.nombre} (dev)\nCuenta:     ${EMAIL}\n`);

let passwordEnPie = PASSWORD_ORIGINAL;
/**
 * ⚠️ Si la restauración falla, el script SIEMPRE sale con código de error,
 * pase lo que pase con `fallos`: dejar la cuenta con una contraseña temporal
 * puesta no es un resultado "en verde" aunque las invariantes se hayan
 * sostenido. El operador tiene que enterarse y arreglarlo a mano.
 */
let restauracionFallo = false;

try {
  // Dos sesiones distintas de la misma persona: A hace el cambio, B es "el otro
  // dispositivo" que tiene que quedarse fuera.
  const a = await entrar(PASSWORD_ORIGINAL);
  if (!a.ok || !a.tokens) {
    abortar(
      "no se pudo entrar con VERIF_PASSWORD. ¿Es la contraseña de carlos en dev? " +
        `(${datosDelError(a.error).mensaje})`,
    );
  }
  const b = await entrar(PASSWORD_ORIGINAL);
  if (!b.ok || !b.tokens) abortar("no se pudo abrir la segunda sesión.");

  const sesionA = comoSesion(a.tokens);
  const yo = await sesionA.query(actual, {});
  console.log(`Sesiones abiertas para ${yo.name} (${yo.rol}).\n`);

  console.log("1) Contraseña actual incorrecta");
  const r1 = await cambiar(sesionA, PASSWORD_MAL, PASSWORD_NUEVA);
  const d1 = datosDelError(r1.error);
  comprobar("se rechaza", !r1.ok, d1.mensaje);
  comprobar(
    "con el código que la pantalla necesita",
    d1.codigo === "PASSWORD_ACTUAL_INCORRECTA",
    `codigo=${d1.codigo}`,
  );
  comprobar("la contraseña NO cambió", (await entrar(PASSWORD_ORIGINAL)).ok);
  comprobar(
    "la otra sesión SIGUE viva (no se revocó nada)",
    await refrescaTodavia(b.tokens),
  );

  console.log("\n2) Contraseña nueva demasiado corta, saltándose la interfaz");
  const r2 = await cambiar(sesionA, PASSWORD_ORIGINAL, PASSWORD_CORTA);
  const d2 = datosDelError(r2.error);
  comprobar("el servidor la rechaza", !r2.ok, d2.mensaje);
  comprobar("la contraseña corta NO entra", !(await entrar(PASSWORD_CORTA)).ok);
  comprobar("la original sigue valiendo", (await entrar(PASSWORD_ORIGINAL)).ok);
  comprobar(
    "la otra sesión SIGUE viva",
    await refrescaTodavia(b.tokens),
  );

  console.log("\n3) Camino feliz");
  const r3 = await cambiar(sesionA, PASSWORD_ORIGINAL, PASSWORD_NUEVA);
  comprobar("el cambio se acepta", r3.ok, datosDelError(r3.error).mensaje);
  if (r3.ok) passwordEnPie = PASSWORD_NUEVA;
  comprobar("mi propia sesión sigue funcionando", (await sesionA.query(actual, {})) != null);
  comprobar("la OTRA sesión quedó revocada", !(await refrescaTodavia(b.tokens)));
  comprobar("la contraseña nueva entra", (await entrar(PASSWORD_NUEVA)).ok);
  comprobar("la contraseña vieja ya NO entra", !(await entrar(PASSWORD_ORIGINAL)).ok);
} finally {
  // Dejar la cuenta como estaba, haya pasado lo que haya pasado.
  if (passwordEnPie !== PASSWORD_ORIGINAL) {
    const restaurar = await entrar(passwordEnPie);
    if (restaurar.ok && restaurar.tokens) {
      const r = await cambiar(
        comoSesion(restaurar.tokens),
        passwordEnPie,
        PASSWORD_ORIGINAL,
      );
      if (r.ok) {
        console.log("\nContraseña restaurada a la original.");
      } else {
        restauracionFallo = true;
        console.error(
          `\n⚠️ NO SE PUDO RESTAURAR LA CONTRASEÑA. La cuenta ${EMAIL} quedó ` +
            `con la temporal de esta corrida: ${passwordEnPie}\n` +
            "Restaurala a mano: " +
            `npx convex run seed:resetearPasswords '{"password":"..."}'`,
        );
      }
    } else {
      restauracionFallo = true;
      console.error(
        `\n⚠️ NO SE PUDO RESTAURAR LA CONTRASEÑA (ni siquiera pude entrar con ` +
          `la temporal). La cuenta ${EMAIL} quedó en un estado desconocido: ` +
          `probá entrar con ${passwordEnPie} o con ${PASSWORD_ORIGINAL}.\n` +
          "Arreglalo a mano: " +
          `npx convex run seed:resetearPasswords '{"password":"..."}'`,
      );
    }
  }
}

console.log(
  fallos.length === 0
    ? "\nTodas las invariantes se sostienen."
    : `\nFALLARON ${fallos.length}: ${fallos.join(" · ")}`,
);
if (restauracionFallo) {
  console.error(
    "\nEXIT 1 forzado por la restauración fallida, aunque las invariantes " +
      "de arriba se hayan sostenido: la cuenta no quedó en su estado original.",
  );
}
process.exit(fallos.length === 0 && !restauracionFallo ? 0 : 1);
