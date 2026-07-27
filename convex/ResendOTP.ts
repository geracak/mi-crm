import { Email } from "@convex-dev/auth/providers/Email";
import type { EmailConfig } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import { normalizarEmail, ENVIO_FALLIDO } from "./emailUtils";

/**
 * GER-239 — Proveedor de código de un solo uso enviado por Resend, usado como
 * `reset` del provider `Password` (`convex/auth.ts`).
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

const MINUTOS_DE_VIDA = 15;
const DIGITOS = 8;

/** Cuerpo de la respuesta que se incluye en los errores, recortado. */
const MAX_CUERPO_ERROR = 300;

const URL_RESEND = "https://api.resend.com/emails";

/** Un cuelgue de red se convierte en error limpio en vez de agotar la acción. */
const TIMEOUT_MS = 10_000;

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
  if (
    normalizarEmail(identificadorCuenta) !== normalizarEmail(emailRecibido)
  ) {
    throw new Error(
      "El código de verificación no corresponde a este correo.",
    );
  }
};

const sendVerificationRequest: EmailConfig["sendVerificationRequest"] = async ({
  identifier: email,
  token,
}) => {
  const apiKey = process.env.RESEND_API_KEY;
  // Sin clave se lanza en vez de intentar el envío: un fetch sin autenticación
  // devolvería 401 y, sin la comprobación de abajo, se tomaría por éxito.
  if (!apiKey) {
    throw new ConvexError(
      `${ENVIO_FALLIDO}: falta la variable de entorno RESEND_API_KEY`,
    );
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
        from: "Vibe CRM <no-reply@red-24.com>",
        // El `identifier` llega SIN normalizar (es `params.email` tal cual lo
        // mandó quien llamó): `createVerificationCode` devuelve `email ?? phone`
        // en crudo. Un espacio final o mayúsculas harían que Resend rechazara
        // la dirección con un 422.
        to: [normalizarEmail(email)],
        subject: `Tu código para recuperar la contraseña: ${token}`,
        text: [
          "Pediste recuperar tu contraseña de Vibe CRM.",
          "",
          `Tu código es: ${token}`,
          "",
          `Vence en ${MINUTOS_DE_VIDA} minutos y solo se puede usar una vez.`,
          "Si no lo pediste vos, ignorá este mensaje: tu contraseña no cambia.",
        ].join("\n"),
        html: [
          "<p>Pediste recuperar tu contraseña de Vibe CRM.</p>",
          `<p style="font-size:28px;font-weight:600;letter-spacing:4px">${token}</p>`,
          `<p>Vence en ${MINUTOS_DE_VIDA} minutos y solo se puede usar una vez.</p>`,
          "<p>Si no lo pediste vos, ignorá este mensaje: tu contraseña no cambia.</p>",
        ].join(""),
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
    const cuerpo = (
      await respuesta.text().catch(() => "(sin cuerpo)")
    ).slice(0, MAX_CUERPO_ERROR);
    throw new ConvexError(
      `${ENVIO_FALLIDO}: Resend rechazó el envío (${respuesta.status}): ${cuerpo}`,
    );
  }
};

const base = Email({ sendVerificationRequest });

export const ResendOTP: EmailConfig = {
  ...base,
  // ⚠️ Queda persistido en `authVerificationCodes.provider`: renombrarlo más
  // adelante invalida los códigos que estén en vuelo.
  id: "resend-otp",
  maxAge: MINUTOS_DE_VIDA * 60,
  from: "Vibe CRM <no-reply@red-24.com>",
  generateVerificationToken,
  authorize,
};
