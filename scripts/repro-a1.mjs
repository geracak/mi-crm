/**
 * GER-240 — Reproducción y test negativo permanente del hallazgo A1 de la
 * auditoría de seguridad del login (27/07/2026).
 *
 * A1: `api.auth.signIn` es una acción PÚBLICA de Convex y su rama
 * `flow: "signUp"` verificaba la contraseña de una cuenta existente SIN
 * consultar `authRateLimits`
 * (@convex-dev/auth/dist/server/implementation/mutations/createAccountFromCredentials.js:23-40),
 * mientras que `flow: "signIn"` sí aplica el límite de 10 fallos/hora
 * (.../retrieveAccountWithCredentials.js:26-33). Resultado: intentos de
 * contraseña ilimitados, sin rastro, y sesión válida al acertar.
 *
 * Este script llama a `auth:signIn` DIRECTO contra el deployment, sin pasar por
 * la interfaz ni por el proxy de Next: es exactamente lo que haría un atacante
 * que solo conoce `NEXT_PUBLIC_CONVEX_URL` (viaja en el bundle del navegador).
 *
 * ⚠️ SOLO CONTRA EL DEPLOYMENT DE DESARROLLO. La puerta de entorno es
 * `resolverDeploymentDev` y es fail-closed: aborta antes de abrir el cliente si
 * el deployment no es `dev:`, si la URL del bundle no es exactamente la de ese
 * mismo deployment. Y los oráculos no pueden desviarse aunque el entorno diga
 * otra cosa: el CLI se lanza con el deployment IMPUESTO (`entornoDelCli`). Ver
 * el porqué en el bloque de cada una de esas dos funciones (hallazgo M1).
 *
 * ⚠️ EL VEREDICTO NO PUEDE LEER MENSAJES DE ERROR. Convex censura el texto de
 * los `Error` normales fuera de desarrollo local y devuelve "Server Error", así
 * que buscar "TooManyFailedAttempts" en el mensaje da un falso negativo SIEMPRE
 * (comprobado en la corrida del baseline: el límite había actuado y el mensaje
 * no lo decía). Los oráculos fiables son otros dos:
 *   1. `ConvexError`, cuyo `data` SÍ llega al cliente — es lo que usa el
 *      rechazo de `signUp`.
 *   2. la tabla `authRateLimits` leída con `npx convex data`, que dice si el
 *      camino registró el intento o no lo tocó.
 *
 * Código de salida: 0 = vector CERRADO · 1 = vector ABIERTO (o fallo de la
 * comprobación). Así sirve de test negativo en verde/rojo.
 *
 * Uso:
 *   REPRO_PASSWORD_CORRECTA="..." node scripts/repro-a1.mjs
 *
 * La contraseña se pasa por variable de entorno a propósito: en `argv` quedaría
 * visible para cualquier proceso que liste la tabla de procesos.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const signIn = makeFunctionReference("auth:signIn");

/** Cuenta objetivo de las pruebas de fuerza bruta por `signUp`. */
const EMAIL_OBJETIVO = "gera.cak@gmail.com";

/**
 * Cuenta usada SOLO para comprobar que el límite legítimo de `flow:"signIn"`
 * sigue vivo. Es otra a propósito: esa prueba agota el presupuesto de intentos
 * y, una vez agotado, ni la contraseña correcta entra hasta que se regenera
 * (~10/hora). Quemar la cuenta de la propietaria dejaría el login de desarrollo
 * inutilizable durante un buen rato.
 */
const EMAIL_SACRIFICABLE = "carlos@vibecrm.local";

const EMAIL_INEXISTENTE = "no-existe-jamas-2026@vibecrm.local";
const PASSWORD_INCORRECTA = "contrasena-incorrecta-a-proposito-000";
const RECHAZO_ESPERADO = "Registro no permitido";
const INTENTOS = 20;

/**
 * Raíz del proyecto. Se usa como `cwd` del CLI para que el hijo resuelva sus
 * archivos dotenv contra el MISMO directorio que lee esta puerta: el CLI los
 * abre por ruta relativa (`ENV_VAR_FILE_PATH = ".env.local"` en
 * `convex/dist/cjs/cli/lib/utils/utils.js:103`), así que lanzar el script desde
 * otro directorio haría que validáramos unos archivos y el CLI leyera otros.
 */
const RAIZ = fileURLToPath(new URL("..", import.meta.url));

/**
 * Lee un archivo dotenv con las mismas reglas que aplica el CLI de Convex.
 * Devuelve `{}` si no existe: la ausencia no es un error, es una fuente vacía.
 *
 * Importa el detalle del comentario en línea: `CONVEX_DEPLOYMENT` lleva uno
 * (`dev:… # team: …, project: …`) y un parseo ingenuo lo arrastraría dentro del
 * valor, rompiendo la derivación del nombre del deployment.
 */
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
      // En un valor SIN comillas, dotenv corta el valor en el primer ` #`.
      valor = valor.split(/\s+#/)[0].trim();
    }
    vars[limpia.slice(0, corte).trim()] = valor;
  }
  return vars;
}

function abortar(motivo) {
  console.error(`ABORTADO: ${motivo}`);
  process.exit(1);
}

/**
 * Variables que le cambian el deployment al CLI por debajo de
 * `CONVEX_DEPLOYMENT`, y que por eso se le imponen vacías al hijo.
 * `getDeploymentSelectionFromEnv` mira PRIMERO la clave de deploy y, si la
 * encuentra, `CONVEX_DEPLOYMENT` ya no decide nada
 * (`convex/dist/cjs/cli/lib/deploymentSelection.js:443-446`); el par
 * self-hosted redirige por su cuenta (`:516-559`).
 */
const VARIABLES_QUE_DESVIAN_EL_CLI = [
  "CONVEX_DEPLOY_KEY",
  "CONVEX_DEPLOYMENT_TOKEN",
  "CONVEX_SELF_HOSTED_URL",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
];

/**
 * GER-240 · M1 — Puerta de entorno fail-closed. Corre ANTES de construir el
 * cliente y antes de la primera llamada.
 *
 * ⚠️ El fallo que cierra: la versión anterior validaba que `CONVEX_DEPLOYMENT`
 * empezara por `dev:` pero abría el cliente HTTP con `NEXT_PUBLIC_CONVEX_URL`.
 * Dos autoridades independientes, nada que las atara. Con el deployment en
 * `dev:` y la URL apuntando a producción —basta una edición a medias del
 * `.env.local`— las sondas A/B/D se lanzaban contra PRODUCCIÓN mientras los
 * oráculos (`convex data`, que sigue a `CONVEX_DEPLOYMENT`) leían las tablas de
 * DESARROLLO. Consecuencia: intentos de contraseña reales contra la cuenta de
 * la propietaria —incluido el del camino de éxito, que puede crear sesión— y un
 * veredicto sin valor por mezclar entornos.
 *
 * ⚠️ La autoridad ahora es ÚNICA: `CONVEX_DEPLOYMENT`, que es de quien depende
 * el CLI. La URL del cliente se DERIVA de su nombre y no se lee del entorno.
 * `NEXT_PUBLIC_CONVEX_URL` se conserva pero degradada a aserción: tiene que
 * coincidir carácter a carácter con la derivada, porque es la URL que viaja en
 * el bundle y la que vería el atacante. Discrepancia = abortar.
 *
 * ⚠️ Por qué esta puerta NO intenta detectar autoridades sueltas en los dotenv
 * del hijo. Se probó y no se sostiene: el CLI carga sus propios `.env.local` y
 * `.env` con dotenv 16.6.1, cuya gramática acepta cosas que un lector casero no
 * ve —`export CONVEX_DEPLOY_KEY=…`, `CONVEX_DEPLOY_KEY: …`, comillas de tres
 * clases— (`convex/dist/cli.bundle.cjs:91609`). Cualquier réplica parcial de esa
 * gramática deja huecos por definición, y perseguirlos es una carrera perdida.
 *
 * Se invierte el enfoque: no se detecta, se CONTIENE. Ver `entornoDelCli`.
 * Consecuencia para esta función: lo que lea de `.env.local` no decide la
 * seguridad, solo la comodidad. Si no encuentra `CONVEX_DEPLOYMENT`, aborta; y
 * el valor que sí encuentre es el que se le impone al hijo, así que sondas y
 * oráculos acaban en el mismo sitio por construcción, no por coincidencia.
 */
function resolverDeploymentDev() {
  // Se lee SOLO `.env.local`, y para dos valores. `.env` ya no se mira: lo que
  // contenga es irrelevante una vez el hijo va con el entorno impuesto.
  const env = leerArchivoEnv(join(RAIZ, ".env.local"));

  const declarado = process.env.CONVEX_DEPLOYMENT ?? env.CONVEX_DEPLOYMENT ?? "";
  const origen = process.env.CONVEX_DEPLOYMENT ? "el proceso" : ".env.local";
  if (declarado === "") {
    abortar("no hay CONVEX_DEPLOYMENT ni en el proceso ni en .env.local.");
  }
  const separador = declarado.indexOf(":");
  const tipo = separador === -1 ? "" : declarado.slice(0, separador);
  const nombre = separador === -1 ? "" : declarado.slice(separador + 1);

  if (tipo !== "dev") {
    abortar(
      `CONVEX_DEPLOYMENT no es de desarrollo (vale "${declarado}", según ${origen}). ` +
        "Este script no se corre nunca contra producción.",
    );
  }
  // El nombre se convierte en un host: cualquier cosa fuera de este alfabeto
  // significa que el parseo no entendió el valor, y de ahí no se deriva una URL.
  if (!/^[a-z0-9-]+$/.test(nombre)) {
    abortar(
      `el nombre del deployment ("${nombre}") no tiene la forma esperada; ` +
        "no se puede derivar su URL con seguridad.",
    );
  }

  const url = `https://${nombre}.convex.cloud`;
  const publicada = (
    process.env.NEXT_PUBLIC_CONVEX_URL ??
    env.NEXT_PUBLIC_CONVEX_URL ??
    ""
  ).replace(/\/+$/, "");
  if (publicada === "") {
    abortar("no hay NEXT_PUBLIC_CONVEX_URL ni en el proceso ni en .env.local.");
  }
  if (publicada !== url) {
    abortar(
      "NEXT_PUBLIC_CONVEX_URL y CONVEX_DEPLOYMENT identifican deployments DISTINTOS.\n" +
        `  CONVEX_DEPLOYMENT      : ${declarado}  →  ${url}   (según ${origen})\n` +
        `  NEXT_PUBLIC_CONVEX_URL : ${publicada}\n` +
        "  Las sondas irían a un deployment y los oráculos a otro. Corregilo antes de seguir.",
    );
  }

  return { declarado, nombre, url, origen };
}

/**
 * GER-240 · M1 — CONTENCIÓN del proceso hijo. Es lo que sostiene la garantía,
 * en lugar de intentar adivinar qué dicen los archivos del proyecto.
 *
 * dotenv NO pisa una variable que ya exista en el entorno recibido, y decide por
 * PRESENCIA, no por valor: `hasOwnProperty(processEnv, key)`
 * (`cli.bundle.cjs:91854`). El CLI, a su vez, trata la cadena vacía como
 * ausencia (`deploymentSelection.js:377-381`). De ahí las dos jugadas:
 *
 *   · `CONVEX_DEPLOYMENT` se IMPONE con el valor `dev:` ya validado, así que
 *     ningún dotenv puede reemplazarlo.
 *   · las variables que tendrían precedencia sobre él se imponen VACÍAS: quedan
 *     presentes —y por tanto blindadas frente a dotenv— pero el CLI las lee como
 *     si no estuvieran.
 *
 * El resultado no depende de saber leer los archivos: por muy exótica que sea la
 * sintaxis con que alguien declare una clave de deploy en `.env.local` o `.env`,
 * dotenv se encontrará la variable ya definida y no la escribirá. Los oráculos
 * no pueden salirse del deployment que validó la puerta.
 */
function entornoDelCli(destino) {
  const entorno = { ...process.env, CONVEX_DEPLOYMENT: destino.declarado };
  for (const variable of VARIABLES_QUE_DESVIAN_EL_CLI) {
    entorno[variable] = "";
  }
  return entorno;
}

/**
 * Lee una tabla del deployment como JSON. El oráculo que no se puede censurar.
 *
 * Se invoca el CLI de Convex por su entrada de Node en vez de por `npx`: en
 * Windows, Node ≥ 20.12 rechaza con EINVAL el spawn de un `.cmd` sin shell, y
 * meter un shell por medio traería problemas de comillas en las rutas con
 * espacios (esta misma, «vibe coding», los tiene).
 *
 * El `cwd` se fija a la raíz del proyecto porque el CLI abre sus dotenv por
 * ruta RELATIVA: sin esto, lanzar el script desde otro directorio haría que el
 * hijo leyera unos archivos distintos de los del proyecto.
 *
 * El entorno va IMPUESTO por `entornoDelCli`, que es lo que garantiza que estas
 * lecturas no puedan salirse del deployment validado.
 */
const CLI_CONVEX = fileURLToPath(
  new URL("../node_modules/convex/bin/main.js", import.meta.url),
);

function crearLectorDeTablas(destino) {
  const env = entornoDelCli(destino);
  return (tabla) => leerTablaCon(env, tabla);
}

function leerTablaCon(env, tabla) {
  const salida = execFileSync(
    process.execPath,
    [CLI_CONVEX, "data", tabla, "--format", "json", "--limit", "100"],
    {
      cwd: RAIZ,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  const inicio = salida.indexOf("[");
  if (inicio === -1) return [];
  return JSON.parse(salida.slice(inicio));
}

const idDeCuenta = (cuentas, email) =>
  cuentas.find((c) => c.provider === "password" && c.providerAccountId === email)?._id ?? null;

const filaLimite = (limites, identificador) =>
  limites.find((l) => l.identifier === identificador) ?? null;

/**
 * Ejecuta una llamada y devuelve un resultado uniforme, sin lanzar: lo que
 * interesa es COMPARAR respuestas, no abortar en la primera.
 */
async function llamar(cliente, params) {
  try {
    const r = await cliente.action(signIn, { provider: "password", params });
    return { ok: true, tokens: r?.tokens ?? null, error: null };
  } catch (err) {
    return {
      ok: false,
      tokens: null,
      error: {
        nombre: err?.constructor?.name ?? "desconocido",
        data: err?.data ?? null,
        mensaje: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

/** ¿Es el rechazo uniforme del wrapper? `ConvexError.data` sí viaja al cliente. */
const esRechazoUniforme = (e) => e !== null && e.data === RECHAZO_ESPERADO;

/**
 * Quita del mensaje los metadatos que cambian en cada llamada. Convex antepone
 * un `[Request ID: …]` distinto por petición, así que comparar el mensaje en
 * crudo daría SIEMPRE "distinguibles" aunque el error fuese idéntico — un falso
 * positivo de enumeración.
 */
const mensajeEstable = (m) =>
  (m ?? "").replace(/\[Request ID: [^\]]*\]/g, "").replace(/\s+/g, " ").trim();

const resumir = (e) =>
  e === null
    ? "(sin error)"
    : `${e.nombre}: ${(e.data ?? e.mensaje ?? "").toString().split("\n")[0].slice(0, 110)}`;

async function main() {
  const destino = resolverDeploymentDev();

  const passwordCorrecta = process.env.REPRO_PASSWORD_CORRECTA;
  if (!passwordCorrecta) {
    abortar(
      "falta REPRO_PASSWORD_CORRECTA. Fijala a la contraseña de desarrollo de la cuenta objetivo\n" +
        "  (se establece con: npx convex run seed:resetearPasswords '{\"password\":\"...\"}').",
    );
  }

  const leerTabla = crearLectorDeTablas(destino);
  const cliente = new ConvexHttpClient(destino.url);
  console.log(`Deployment : ${destino.declarado}  (según ${destino.origen})`);
  console.log(`URL sondas : ${destino.url}  (derivada, = NEXT_PUBLIC_CONVEX_URL)`);
  console.log(`Oráculos   : convex data con CONVEX_DEPLOYMENT impuesta a ${destino.declarado},`);
  console.log(`             ${VARIABLES_QUE_DESVIAN_EL_CLI.join(", ")} impuestas vacías,`);
  console.log(`             cwd ${RAIZ}\n`);

  const cuentas = leerTabla("authAccounts");
  const idObjetivo = idDeCuenta(cuentas, EMAIL_OBJETIVO);
  const idSacrificable = idDeCuenta(cuentas, EMAIL_SACRIFICABLE);
  if (idObjetivo === null || idSacrificable === null) {
    console.error(
      `ABORTADO: faltan cuentas de prueba en el deployment (${EMAIL_OBJETIVO} / ${EMAIL_SACRIFICABLE}).\n` +
        "Sembralas con: npx convex run seed:sembrarUsuarios '{\"martaPassword\":\"...\",\"carlosPassword\":\"...\"}'",
    );
    process.exit(1);
  }

  let vectorAbierto = false;

  // ── A · Fuerza bruta por `flow:"signUp"` con contraseña incorrecta ────────
  console.log(`A · ${INTENTOS} × signUp con contraseña INCORRECTA contra ${EMAIL_OBJETIVO}`);
  const limiteAntesA = filaLimite(leerTabla("authRateLimits"), idObjetivo);
  const erroresA = [];
  for (let i = 0; i < INTENTOS; i++) {
    const r = await llamar(cliente, {
      email: EMAIL_OBJETIVO,
      password: PASSWORD_INCORRECTA,
      flow: "signUp",
    });
    erroresA.push(r.error);
  }
  const limiteDespuesA = filaLimite(leerTabla("authRateLimits"), idObjetivo);
  const rechazadasA = erroresA.filter(esRechazoUniforme).length;
  const tocoLaTablaA =
    (limiteAntesA?.lastAttemptTime ?? null) !== (limiteDespuesA?.lastAttemptTime ?? null);

  console.log(`   primera : ${resumir(erroresA[0])}`);
  console.log(`   última  : ${resumir(erroresA[erroresA.length - 1])}`);
  console.log(`   rechazadas con "${RECHAZO_ESPERADO}": ${rechazadasA}/${INTENTOS}`);
  console.log(
    `   authRateLimits del objetivo: lastAttemptTime ${tocoLaTablaA ? "AVANZÓ" : "SIN TOCAR"}` +
      ` (attemptsLeft ${limiteAntesA?.attemptsLeft ?? "(sin fila)"} → ${limiteDespuesA?.attemptsLeft ?? "(sin fila)"})`,
  );
  if (rechazadasA === INTENTOS) {
    console.log("   ✅ todas rechazadas antes de verificar la contraseña\n");
  } else {
    console.log(
      `   🔴 ${INTENTOS - rechazadasA}/${INTENTOS} llegaron a verificar contraseña sin rechazo uniforme\n`,
    );
    vectorAbierto = true;
  }

  // ── B · El camino de éxito del exploit: contraseña CORRECTA por signUp ────
  console.log(`B · 1 × signUp con contraseña CORRECTA contra ${EMAIL_OBJETIVO}`);
  const sesionesAntes = leerTabla("authSessions").length;
  const b = await llamar(cliente, {
    email: EMAIL_OBJETIVO,
    password: passwordCorrecta,
    flow: "signUp",
  });
  const sesionesDespues = leerTabla("authSessions").length;
  console.log(`   respuesta      : ${b.tokens ? "DEVOLVIÓ TOKENS" : resumir(b.error)}`);
  console.log(`   authSessions   : ${sesionesAntes} → ${sesionesDespues}`);
  if (b.tokens || sesionesDespues > sesionesAntes) {
    console.log("   🔴 la ruta de registro emitió una sesión válida\n");
    vectorAbierto = true;
  } else if (esRechazoUniforme(b.error)) {
    console.log("   ✅ rechazada con el mismo error, sin sesión nueva\n");
  } else {
    console.log("   🔴 no emitió sesión, pero el rechazo NO es el uniforme\n");
    vectorAbierto = true;
  }

  // ── C · El límite legítimo de `flow:"signIn"` sigue vivo ──────────────────
  // Oráculo: la tabla, no el mensaje. Se comprueba que el camino REGISTRA el
  // intento (lastAttemptTime avanza) y que el presupuesto queda agotado.
  console.log(`C · ${INTENTOS} × signIn con contraseña INCORRECTA contra ${EMAIL_SACRIFICABLE}`);
  const limiteAntesC = filaLimite(leerTabla("authRateLimits"), idSacrificable);
  for (let i = 0; i < INTENTOS; i++) {
    await llamar(cliente, {
      email: EMAIL_SACRIFICABLE,
      password: PASSWORD_INCORRECTA,
      flow: "signIn",
    });
  }
  const limiteDespuesC = filaLimite(leerTabla("authRateLimits"), idSacrificable);
  const registro =
    (limiteAntesC?.lastAttemptTime ?? 0) !== (limiteDespuesC?.lastAttemptTime ?? 0) ||
    (limiteAntesC === null && limiteDespuesC !== null);
  // El presupuesto agotado es la aserción; que `lastAttemptTime` avance es solo
  // informativo y NO puede exigirse: una vez bloqueada la cuenta,
  // `isSignInRateLimited` corta ANTES de `recordFailedSignIn`
  // (retrieveAccountWithCredentials.js:26-31), así que la marca deja de moverse
  // precisamente cuando el límite está haciendo su trabajo.
  const agotado = limiteDespuesC !== null && limiteDespuesC.attemptsLeft < 1;
  console.log(
    `   authRateLimits: attemptsLeft ${limiteAntesC?.attemptsLeft ?? "(sin fila)"} → ${limiteDespuesC?.attemptsLeft ?? "(sin fila)"}` +
      ` · lastAttemptTime ${registro ? "AVANZÓ" : "sin tocar (ya bloqueada)"}`,
  );
  if (agotado) {
    console.log("   ✅ el límite legítimo está actuando (presupuesto agotado)\n");
  } else {
    console.log("   🔴 el límite legítimo NO está actuando\n");
    vectorAbierto = true;
  }

  // ── D · Oráculo de enumeración (hallazgo A2) ──────────────────────────────
  console.log("D · signUp: correo INEXISTENTE vs. correo EXISTENTE");
  const dNuevo = await llamar(cliente, {
    email: EMAIL_INEXISTENTE,
    password: PASSWORD_INCORRECTA,
    flow: "signUp",
  });
  const dExiste = await llamar(cliente, {
    email: EMAIL_OBJETIVO,
    password: PASSWORD_INCORRECTA,
    flow: "signUp",
  });
  console.log(`   inexistente : ${resumir(dNuevo.error)}`);
  console.log(`   existente   : ${resumir(dExiste.error)}`);
  const iguales =
    dNuevo.error?.nombre === dExiste.error?.nombre &&
    JSON.stringify(dNuevo.error?.data) === JSON.stringify(dExiste.error?.data) &&
    mensajeEstable(dNuevo.error?.mensaje) === mensajeEstable(dExiste.error?.mensaje);
  if (iguales) {
    console.log("   ✅ indistinguibles (tipo, data y mensaje coinciden)\n");
  } else {
    console.log("   🔴 DISTINGUIBLES — sirve de oráculo para enumerar cuentas\n");
    vectorAbierto = true;
  }

  console.log("─".repeat(70));
  if (vectorAbierto) {
    console.log("VEREDICTO: 🔴 VECTOR ABIERTO — A1/A2 explotables");
    process.exit(1);
  }
  console.log("VEREDICTO: ✅ VECTOR CERRADO");
  process.exit(0);
}

await main();
