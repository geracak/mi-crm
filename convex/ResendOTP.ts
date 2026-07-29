import { Email } from "@convex-dev/auth/providers/Email";
import type { EmailConfig } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { normalizarEmail, ENVIO_FALLIDO } from "./emailUtils";

/**
 * GER-239 / GER-219 (E2) — Proveedor del código de un solo uso que se manda por
 * Resend, usado como `reset` del provider `Password` (`convex/auth.ts`).
 *
 * Manda DOS correos distintos según quién esté del otro lado:
 *
 *   invitación    la persona nunca tuvo contraseña (`passwordPendiente`), así
 *                 que el correo NO habla de recuperar nada: le da la bienvenida
 *                 y le pasa el código para que elija la suya. Vive 24 h.
 *   recuperación  la persona ya tiene contraseña y pidió cambiarla. Vive 15 min.
 *
 * ⚠️ `Email()` NO se usa tal cual, y esto NO es opcional. Verificado en
 * `@convex-dev/auth@0.0.94` (`src/providers/Email.ts:36-59`): la función
 * devuelve un objeto con `id: "email"`, `from` de Auth.js y `maxAge: 3600`
 * HARDCODEADOS, y mete todo lo que le pases en `options`, que el runtime nunca
 * lee — `signIn.ts` consulta `provider.maxAge` y
 * `provider.generateVerificationToken` del nivel superior. Pasarlos como config
 * se ignora EN SILENCIO: saldría provider "email", una hora de caducidad y un
 * token aleatorio de 32 caracteres en vez del de 8 dígitos.
 * De ahí el spread + sobrescritura explícita de abajo.
 */

/** Vida del código de recuperación: hay una contraseña vigente que proteger. */
const MINUTOS_RECUPERACION = 15;

/**
 * Vida del código de invitación. Largo a propósito: nadie abre el correo al
 * instante, y con 15 minutos lo primero que vería del producto quien acaba de
 * ser invitada sería "código incorrecto o vencido".
 */
const HORAS_INVITACION = 24;

const DIGITOS = 8;

/**
 * ⚠️ `maxAge` es el tope EXTERIOR, no el vencimiento real.
 *
 * La librería solo admite un vencimiento por proveedor: lo lee una sola vez al
 * generar el código (`dist/server/implementation/signIn.js:61`,
 * `Date.now() + provider.maxAge * 1000`) y ahí no hay forma de saber a quién se
 * le está mandando. Por eso se pone el mayor de los dos y el vencimiento que
 * corresponde a cada caso se guarda en `users.codigoVenceEn` al enviar (abajo)
 * y se exige antes de cambiar la contraseña (wrapper `authorize` de
 * `convex/auth.ts`). Bajar este número por debajo de `HORAS_INVITACION` haría
 * que las invitaciones vencieran antes de tiempo sin que ningún check avise.
 */
const MAX_AGE_S = HORAS_INVITACION * 60 * 60;

/** Cuerpo de la respuesta que se incluye en los errores, recortado. */
const MAX_CUERPO_ERROR = 300;

const URL_RESEND = "https://api.resend.com/emails";

/** Un cuelgue de red se convierte en error limpio en vez de agotar la acción. */
const TIMEOUT_MS = 10_000;

const REMITENTE = "Vibe CRM <no-reply@red-24.com>";

/**
 * Código numérico de 8 dígitos con muestreo por rechazo.
 *
 * No se usa `byte % 10` directamente: 256 no es múltiplo de 10, así que los
 * dígitos 0-5 saldrían con más probabilidad que 6-9. Se descartan los bytes
 * ≥ 250 (250 = 25 × 10) y sobre el resto el módulo ya es uniforme.
 */
async function generateVerificationToken(): Promise<string> {
  let codigo = "";
  const buffer = new Uint8Array(DIGITOS * 2);
  while (codigo.length < DIGITOS) {
    crypto.getRandomValues(buffer);
    for (const byte of buffer) {
      if (byte >= 250) continue; // sesgo: descartar
      codigo += (byte % 10).toString();
      if (codigo.length === DIGITOS) break;
    }
  }
  return codigo;
}

/**
 * Igual que el `authorize` por defecto de la librería, pero comparando ambos
 * lados normalizados: sin esto, pedir el código con "Gera@X.com" y verificarlo
 * con "gera@x.com" fallaría aunque la cuenta se hubiera encontrado.
 *
 * Se conserva el fallo duro cuando falta el correo: la comprobación es lo que
 * ata el código de 8 dígitos a un destinatario concreto. Sin ella el código
 * sería credencial única, que es justo lo que la librería advierte que no debe
 * hacerse con tokens de menos de 24 caracteres.
 */
const authorize: NonNullable<EmailConfig["authorize"]> = async (
  params,
  account,
) => {
  const emailRecibido = params.email;
  if (typeof emailRecibido !== "string") {
    throw new Error(
      "La verificación del código requiere un `email` en los params de `signIn`.",
    );
  }
  // `account` viene tipado contra `GenericDataModel` (firma genérica de la
  // librería), donde los campos son `Value`; se comprueba en vez de castear.
  const identificadorCuenta = account.providerAccountId;
  if (typeof identificadorCuenta !== "string") {
    throw new Error("La cuenta no tiene un identificador de correo válido.");
  }
  if (normalizarEmail(identificadorCuenta) !== normalizarEmail(emailRecibido)) {
    throw new Error("El código de verificación no corresponde a este correo.");
  }
};

/**
 * Escapa lo que va dentro del HTML del correo.
 *
 * Hace falta para el NOMBRE, que lo escribió una persona en el modal de alta:
 * sin escapar, un nombre con `<`, `>` o `&` rompe el marcado o mete HTML ajeno
 * en el mensaje. El `&` va primero o volvería a escapar lo que escapan los
 * demás. (El código de 8 dígitos lo generamos nosotros y son solo dígitos.)
 */
function escapeHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type Correo = { subject: string; text: string; html: string };

/**
 * Correo de INVITACIÓN. Lleva el código directamente.
 *
 * ⚠️ No dice "¿olvidaste tu contraseña?" ni manda a esa pantalla, a propósito:
 * quien recibe esto NUNCA tuvo una contraseña, así que esa frase sería
 * literalmente falsa y además la haría dudar de si el correo es legítimo.
 *
 * ⚠️ NO lleva ningún enlace con token de un solo uso. Los antivirus y los
 * gateways de correo corporativos PRE-VISITAN los enlaces para escanearlos, así
 * que un "magic link" quedaría consumido antes de que la persona llegara a
 * tocarlo. Acá solo hay un enlace plano al login (visitarlo no gasta nada) y el
 * código viaja aparte, como texto para teclear.
 */
function correoInvitacion(datos: {
  nombre?: string;
  etiquetaRol?: string;
  codigo: string;
  urlLogin: string;
}): Correo {
  const saludo = datos.nombre ? `Hola ${datos.nombre}:` : "Hola:";
  const comoRol = datos.etiquetaRol ? ` como "${datos.etiquetaRol}"` : "";

  const text = [
    saludo,
    "",
    `Te dieron de alta en Vibe CRM${comoRol}.`,
    "",
    `Tu código para entrar por primera vez es: ${datos.codigo}`,
    "",
    `Abrí ${datos.urlLogin}, escribí este correo y después el código.`,
    "Ahí elegís tu contraseña.",
    "",
    `El código vence en ${HORAS_INVITACION} horas y solo se puede usar una vez.`,
    "Si no esperabas este mensaje, podés ignorarlo.",
  ].join("\n");

  const comoRolHtml = datos.etiquetaRol
    ? ` como <strong>${escapeHtml(datos.etiquetaRol)}</strong>`
    : "";
  const html = [
    `<p>${escapeHtml(saludo)}</p>`,
    `<p>Te dieron de alta en Vibe CRM${comoRolHtml}.</p>`,
    "<p>Tu código para entrar por primera vez es:</p>",
    `<p style="font-size:28px;font-weight:600;letter-spacing:4px">${datos.codigo}</p>`,
    `<p>Abrí <a href="${escapeHtml(datos.urlLogin)}">${escapeHtml(datos.urlLogin)}</a>, escribí este correo y después el código. Ahí elegís tu contraseña.</p>`,
    `<p>El código vence en ${HORAS_INVITACION} horas y solo se puede usar una vez.</p>`,
    "<p>Si no esperabas este mensaje, podés ignorarlo.</p>",
  ].join("");

  return {
    subject: `Tu código para entrar a Vibe CRM: ${datos.codigo}`,
    text,
    html,
  };
}

/** Correo de RECUPERACIÓN: para quien ya tiene contraseña y quiere cambiarla. */
function correoRecuperacion(codigo: string): Correo {
  return {
    subject: `Tu código para recuperar la contraseña: ${codigo}`,
    text: [
      "Pediste recuperar tu contraseña de Vibe CRM.",
      "",
      `Tu código es: ${codigo}`,
      "",
      `Vence en ${MINUTOS_RECUPERACION} minutos y solo se puede usar una vez.`,
      "Si no lo pediste vos, ignorá este mensaje: tu contraseña no cambia.",
    ].join("\n"),
    html: [
      "<p>Pediste recuperar tu contraseña de Vibe CRM.</p>",
      `<p style="font-size:28px;font-weight:600;letter-spacing:4px">${codigo}</p>`,
      `<p>Vence en ${MINUTOS_RECUPERACION} minutos y solo se puede usar una vez.</p>`,
      "<p>Si no lo pediste vos, ignorá este mensaje: tu contraseña no cambia.</p>",
    ].join(""),
  };
}

/**
 * ⚠️ El segundo parámetro `ctx` NO está en el tipo público `EmailConfig`, pero
 * el runtime SÍ lo pasa: `dist/server/implementation/signIn.js:94-96` lo entrega
 * con un `@ts-expect-error` propio de la librería que dice literalmente
 * "Figure out typing for email providers so they can access ctx". Verificado en
 * el código, no en los tipos — por eso la firma se declara acá a mano y el
 * objeto final se castea abajo.
 */
type EnviarCodigo = (
  params: { identifier: string; token: string },
  ctx: ActionCtx,
) => Promise<void>;

const sendVerificationRequest: EnviarCodigo = async (
  { identifier: email, token },
  ctx,
) => {
  const apiKey = process.env.RESEND_API_KEY;
  // Sin clave se lanza en vez de intentar el envío: un fetch sin autenticación
  // devolvería 401 y, sin la comprobación de abajo, se tomaría por éxito.
  if (!apiKey) {
    throw new ConvexError(
      `${ENVIO_FALLIDO}: falta la variable de entorno RESEND_API_KEY`,
    );
  }

  // El `identifier` llega SIN normalizar (es `params.email` tal cual lo mandó
  // quien llamó): `createVerificationCode` devuelve `email ?? phone` en crudo.
  // Un espacio final o mayúsculas harían que Resend rechazara la dirección con
  // un 422, y además impedirían encontrar la cuenta acá abajo.
  const destino = normalizarEmail(email);

  const datos = await ctx.runQuery(internal.usuarios._datosParaCorreo, {
    email: destino,
  });
  // `null` = no hay cuenta con ese correo. Se trata como recuperación: es el
  // camino que no revela nada. (En la práctica no se llega, porque el flujo
  // `reset` de la librería exige que la cuenta exista antes de generar código.)
  const esInvitacion = datos?.pendiente === true;

  const venceEn =
    Date.now() +
    (esInvitacion
      ? HORAS_INVITACION * 60 * 60 * 1000
      : MINUTOS_RECUPERACION * 60 * 1000);
  await ctx.runMutation(internal.usuarios._fijarVencimientoCodigo, {
    email: destino,
    venceEn,
  });

  let correo: Correo;
  if (esInvitacion) {
    const siteUrl = process.env.SITE_URL;
    if (!siteUrl) {
      throw new ConvexError(
        `${ENVIO_FALLIDO}: falta la variable de entorno SITE_URL`,
      );
    }
    correo = correoInvitacion({
      nombre: datos?.name,
      etiquetaRol: datos?.etiquetaRol,
      codigo: token,
      urlLogin: `${siteUrl.replace(/\/$/, "")}/login`,
    });
  } else {
    correo = correoRecuperacion(token);
  }

  // ⚠️ El `fetch` va envuelto a propósito. `fetch` LANZA (no devuelve una
  // respuesta) ante fallos de transporte: DNS, TLS, red caída, timeout. Ese
  // error sería un Error normal, no un ConvexError con la marca, así que la
  // interfaz lo tomaría por "cualquier otro error" y mostraría el mensaje
  // neutro — diría que enviamos un código que nunca salió. Comprobar
  // `respuesta.ok` solo cubre lo que pasa DESPUÉS de tener respuesta.
  let respuesta: Response;
  try {
    respuesta = await fetch(URL_RESEND, {
      method: "POST",
      // Un cuelgue se corta acá en vez de agotar el tiempo de la acción; el
      // AbortError cae en este mismo catch.
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: REMITENTE,
        to: [destino],
        subject: correo.subject,
        text: correo.text,
        html: correo.html,
      }),
    });
  } catch (causa) {
    // Solo el mensaje, recortado: nunca la traza, ni las cabeceras, ni la clave.
    const detalle = (
      causa instanceof Error ? causa.message : String(causa)
    ).slice(0, MAX_CUERPO_ERROR);
    throw new ConvexError(
      `${ENVIO_FALLIDO}: no se pudo contactar con Resend: ${detalle}`,
    );
  }

  // `fetch` NO lanza en 4xx/5xx. Sin esto, un rechazo de Resend se tomaría por
  // envío correcto y la interfaz diría que mandó un código que no existe.
  if (!respuesta.ok) {
    // Se incluyen estado y cuerpo recortado para poder diagnosticar; jamás las
    // cabeceras ni la API key. `text()` también puede lanzar si la conexión se
    // corta a media lectura, así que no puede tumbar el error real.
    const cuerpo = (await respuesta.text().catch(() => "(sin cuerpo)")).slice(
      0,
      MAX_CUERPO_ERROR,
    );
    throw new ConvexError(
      `${ENVIO_FALLIDO}: Resend rechazó el envío (${respuesta.status}): ${cuerpo}`,
    );
  }
};

const base = Email({
  sendVerificationRequest: sendVerificationRequest as unknown as EmailConfig["sendVerificationRequest"],
});

export const ResendOTP: EmailConfig = {
  ...base,
  // ⚠️ Queda persistido en `authVerificationCodes.provider`: renombrarlo más
  // adelante invalida los códigos que estén en vuelo.
  id: "resend-otp",
  maxAge: MAX_AGE_S,
  from: REMITENTE,
  generateVerificationToken,
  authorize,
};
