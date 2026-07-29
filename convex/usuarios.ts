import { v, ConvexError } from "convex/values";
import {
  query,
  action,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { DataModel, Id } from "./_generated/dataModel";
import { createAccount, invalidateSessions } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { requireUsuario, requirePropietaria } from "./authz";
import { normalizarEmail } from "./emailUtils";

const ROL = v.union(v.literal("propietaria"), v.literal("comercial"));

type Rol = "propietaria" | "comercial";

/** Cómo se llama cada rol de cara a la gente (PRD F18). */
const ETIQUETA_ROL: Record<Rol, string> = {
  propietaria: "Dueña",
  comercial: "Atiende y vende",
};

/** El usuario de la sesión actual (para la cabecera, autoría, etc.). */
export const actual = query({
  args: {},
  returns: v.object({
    _id: v.id("users"),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    rol: ROL,
  }),
  handler: async (ctx) => {
    const u = await requireUsuario(ctx);
    return { _id: u._id, name: u.name, email: u.email, rol: u.rol! };
  },
});

/** Usuarios provisionados del negocio, para el selector de responsable (TAL-15). */
export const listar = query({
  args: {},
  returns: v.array(
    v.object({ _id: v.id("users"), name: v.optional(v.string()), rol: ROL }),
  ),
  handler: async (ctx) => {
    await requireUsuario(ctx);
    const todos = await ctx.db.query("users").collect();
    return todos
      .filter((u) => u.rol === "propietaria" || u.rol === "comercial")
      .map((u) => ({ _id: u._id, name: u.name, rol: u.rol! }));
  },
});

/**
 * GER-219 — El equipo completo para `/equipo`, solo para la dueña.
 *
 * Distinta de `listar` a propósito: aquella la usa cualquier persona con acceso
 * para elegir responsable de un seguimiento y NO expone correos. Esta sí los
 * expone, así que exige rol `propietaria`.
 *
 * Escala MVP: `collect()` de toda la tabla. Son 2-8 personas; si el negocio
 * creciera de verdad habría que paginar.
 */
export const equipo = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("users"),
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      rol: ROL,
    }),
  ),
  handler: async (ctx) => {
    await requirePropietaria(ctx);
    const todos = await ctx.db.query("users").collect();
    return todos
      .filter((u) => u.rol === "propietaria" || u.rol === "comercial")
      .map((u) => ({ _id: u._id, name: u.name, email: u.email, rol: u.rol! }))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "es"));
  },
});

/**
 * Autoriza a la dueña desde una `action`, que no tiene `ctx.db` tipado con el
 * modelo del proyecto. Mismo patrón que usa `recuperacion.ts` para leer datos
 * desde una acción. Devuelve quién está invitando, para firmar el correo.
 */
export const _requirePropietariaActor = internalQuery({
  args: {},
  returns: v.object({ _id: v.id("users"), name: v.optional(v.string()) }),
  handler: async (ctx) => {
    const u = await requirePropietaria(ctx);
    return { _id: u._id, name: u.name };
  },
});

/**
 * ¿Ese correo ya está en uso? Mira DOS sitios, y hacen falta los dos.
 *
 * ⚠️ `authAccounts.providerAndAccountId` NO es un índice único (Convex no los
 * tiene) y en este proyecto `users.email` y `providerAccountId` ya divergieron
 * una vez de verdad — ver `authMaintenance.ts::migrarIdentificadorPassword`.
 * Un correo puede no figurar como `users.email` de nadie y aun así chocar con
 * la credencial heredada de otra persona; si dejáramos pasar ese caso
 * quedarían dos filas con el mismo `(provider, providerAccountId)` y tanto el
 * login como la recuperación de contraseña se volverían ambiguos para ambas.
 */
export const _buscarPorEmail = internalQuery({
  args: { email: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const enUsers = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .take(1);
    if (enUsers.length > 0) return true;

    const enCuentas = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "password").eq("providerAccountId", args.email),
      )
      .take(1);
    return enCuentas.length > 0;
  },
});

/**
 * GER-219 — Apaga la marca de "contraseña puesta por el sistema".
 *
 * NO es pública y no la llama el cliente: la invoca el wrapper `authorize` de
 * `convex/auth.ts` en el servidor, justo después de un `reset-verification`
 * exitoso. Ese es el momento autoritativo, y hacerlo ahí evita depender de que
 * el navegador ya tenga la sesión confirmada (ver el comentario largo allá).
 *
 * Idempotente: si ya estaba apagada, o el usuario ya no existe, no hace nada.
 */
export const _marcarPasswordConfigurada = internalMutation({
  args: { id: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const u = await ctx.db.get(args.id);
    if (u === null || u.passwordPendiente !== true) return null;
    await ctx.db.patch(args.id, { passwordPendiente: false });
    return null;
  },
});

/**
 * Cuenta las dueñas que hay ahora mismo. Sobre la tabla entera porque no hay
 * índice por `rol` y son un puñado de filas (mismo criterio que `listar`).
 */
async function contarPropietarias(ctx: QueryCtx): Promise<number> {
  const todos = await ctx.db.query("users").collect();
  return todos.filter((u) => u.rol === "propietaria").length;
}

/**
 * Todo lo que tiene que ser cierto para poder editar a alguien. Es una función
 * normal, no una query: así corre DENTRO de la transacción de quien la llame
 * (la validación previa de la acción y, otra vez, la mutación que escribe).
 */
async function validarActualizacion(
  ctx: QueryCtx,
  args: { id: Id<"users">; nombre: string; email: string; rol: Rol },
) {
  const objetivo = await ctx.db.get(args.id);
  if (objetivo === null) {
    throw new ConvexError("Esa persona ya no está en el equipo");
  }

  const nombre = args.nombre.trim();
  if (nombre.length === 0) throw new ConvexError("El nombre es obligatorio");

  const email = normalizarEmail(args.email);
  if (email.length === 0 || !email.includes("@")) {
    throw new ConvexError("Indica un correo válido");
  }

  // El negocio no puede quedarse sin ninguna dueña.
  if (objetivo.rol === "propietaria" && args.rol !== "propietaria") {
    if ((await contarPropietarias(ctx)) <= 1) {
      throw new ConvexError("No podés dejar el negocio sin ninguna dueña.");
    }
  }

  // Correo nuevo: los mismos dos frentes que `_buscarPorEmail`, ignorando lo
  // que sea de esta misma persona. `take(2)` en vez de `first()`/`unique()`
  // para no elegir una fila al azar si hubiera varias.
  if (email !== objetivo.email) {
    const ajenosEnUsers = (
      await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", email))
        .take(2)
    ).filter((u) => u._id !== args.id);
    if (ajenosEnUsers.length > 0) {
      throw new ConvexError("Ya hay una persona con ese correo en el equipo.");
    }

    const ajenosEnCuentas = (
      await ctx.db
        .query("authAccounts")
        .withIndex("providerAndAccountId", (q) =>
          q.eq("provider", "password").eq("providerAccountId", email),
        )
        .take(2)
    ).filter((c) => c.userId !== args.id);
    if (ajenosEnCuentas.length > 0) {
      throw new ConvexError("Ya hay una persona con ese correo en el equipo.");
    }
  }

  return { objetivo, nombre, email };
}

/** Validación de solo lectura, antes de producir ningún efecto (ver `actualizar`). */
export const _validarActualizacion = internalQuery({
  args: { id: v.id("users"), nombre: v.string(), email: v.string(), rol: ROL },
  returns: v.null(),
  handler: async (ctx, args) => {
    await validarActualizacion(ctx, args);
    return null;
  },
});

/**
 * Escribe la edición. Repite las validaciones puertas adentro: entre la
 * comprobación previa de la acción y este momento pudo cambiar algo, y la
 * transacción de la mutación es la única que puede garantizar la invariante.
 */
export const _actualizarFilas = internalMutation({
  args: { id: v.id("users"), nombre: v.string(), email: v.string(), rol: ROL },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { objetivo, nombre, email } = await validarActualizacion(ctx, args);
    const emailCambio = email !== objetivo.email;

    await ctx.db.patch(args.id, { name: nombre, email, rol: args.rol });

    if (!emailCambio) return null;

    // El login por contraseña identifica la cuenta por
    // `authAccounts.providerAccountId`, NO por `users.email`. Sin mover esto,
    // cambiar el correo desde /equipo dejaría a esa persona sin poder entrar.
    const cuentasPassword = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) =>
        q.eq("userId", args.id).eq("provider", "password"),
      )
      .take(2);
    if (cuentasPassword.length > 1) {
      throw new ConvexError(
        "Esa cuenta tiene más de una credencial de contraseña. Abortado sin escribir el correo nuevo.",
      );
    }
    if (cuentasPassword.length === 1) {
      await ctx.db.patch(cuentasPassword[0]._id, { providerAccountId: email });
    }

    // ⚠️ Desvincular Google. Una cuenta de Google ya vinculada se reconoce por
    // su propio `authAccount` (por el `sub` de Google, no por el correo): en
    // `createOrUpdateUser`, cuando ya existe el vínculo solo se revalida el
    // `rol` y se deja entrar, SIN comparar el correo de Google contra
    // `users.email`. O sea que sin borrar esto, quien tuviera Google vinculado
    // al correo VIEJO seguiría entrando para siempre después de que la dueña le
    // cambiara el correo — justo el acceso que se quería revocar.
    //
    // Borrándolo, el próximo intento cae en la rama de vinculación por correo,
    // que sí compara contra `users.email` (ya distinto) y lo rechaza. Si la
    // persona real quiere volver a usar Google, se vincula sola en su próximo
    // login con la cuenta que corresponda a su correo nuevo.
    const cuentasGoogle = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) =>
        q.eq("userId", args.id).eq("provider", "google"),
      )
      .collect();
    for (const cuenta of cuentasGoogle) {
      await ctx.db.delete(cuenta._id);
    }

    return null;
  },
});

/**
 * GER-219 — Edita a una persona del equipo (nombre, correo, rol).
 *
 * ⚠️ El ORDEN de los pasos es la parte importante: se revoca ANTES de escribir.
 *
 * `_actualizarFilas` e `invalidateSessions` son transacciones separadas, no
 * atómicas entre sí. Si se invalidara al final, entre "queda escrito el correo
 * nuevo" y "se cierran las sesiones" habría siempre una ventana con la
 * identidad ya cambiada y la sesión vieja todavía válida — y si esa segunda
 * llamada fallara, la ventana quedaría abierta indefinidamente. Invirtiendo el
 * orden, el peor caso posible pasa a ser "se cerró una sesión de más y la
 * escritura no llegó a aplicarse": molesto, nunca inseguro.
 *
 * La validación de solo lectura del paso 2 existe para que ese caso molesto sea
 * raro (se comprueba todo lo comprobable antes de tocar ninguna sesión), no
 * para garantizar el orden: lo que hace esto fail-closed es que el paso 3 vaya
 * antes que el 4, siempre y sin condicionarlo a nada.
 */
export const actualizar = action({
  args: { id: v.id("users"), nombre: v.string(), email: v.string(), rol: ROL },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.runQuery(internal.usuarios._requirePropietariaActor, {});
    await ctx.runQuery(internal.usuarios._validarActualizacion, args);
    await invalidateSessions<DataModel>(ctx, { userId: args.id });
    await ctx.runMutation(internal.usuarios._actualizarFilas, args);
    return null;
  },
});

/** Borra a la persona y sus credenciales. Las guardas van acá, en la transacción. */
export const _eliminarFilas = internalMutation({
  args: { id: v.id("users"), actorId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.id === args.actorId) {
      throw new ConvexError("No podés eliminar tu propio acceso.");
    }
    const objetivo = await ctx.db.get(args.id);
    if (objetivo === null) {
      throw new ConvexError("Esa persona ya no está en el equipo");
    }
    if (objetivo.rol === "propietaria" && (await contarPropietarias(ctx)) <= 1) {
      throw new ConvexError("No podés dejar el negocio sin ninguna dueña.");
    }

    // Todas sus credenciales, de cualquier proveedor (password y google).
    const cuentas = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", args.id))
      .collect();
    for (const cuenta of cuentas) {
      await ctx.db.delete(cuenta._id);
    }
    await ctx.db.delete(args.id);
    return null;
  },
});

/**
 * GER-219 — Quita el acceso de alguien del equipo.
 *
 * Acá el borrado va primero y la invalidación después, al revés que en
 * `actualizar`, y es seguro: en cuanto la fila de `users` desaparece,
 * `requireUsuario` corta cualquier sesión que quedara viva ("Usuario no
 * encontrado"). El acceso muere con la escritura; `invalidateSessions` es la
 * limpieza de las filas de sesión que quedaron sueltas.
 */
export const eliminar = action({
  args: { id: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const actor = await ctx.runQuery(
      internal.usuarios._requirePropietariaActor,
      {},
    );
    await ctx.runMutation(internal.usuarios._eliminarFilas, {
      id: args.id,
      actorId: actor._id,
    });
    await invalidateSessions<DataModel>(ctx, { userId: args.id });
    return null;
  },
});

/**
 * GER-219 — Da de alta a alguien del equipo y le manda la invitación.
 *
 * La cuenta nace con una contraseña aleatoria que NADIE ve nunca, y marcada
 * como `passwordPendiente`. Hace falta crearla igual (y no dejar la cuenta a
 * medio hacer) porque el flujo de código de `@convex-dev/auth` opera sobre una
 * credencial que ya exista: sin ella no se le podría mandar ningún código.
 *
 * La marca viaja en el `profile` y la escribe `createOrUpdateUser` dentro del
 * MISMO insert que crea la fila — nunca en una segunda escritura, que si
 * fallara dejaría una invitación imposible de arreglar desde /equipo.
 *
 * Si el correo no sale, el alta NO se revierte: la persona queda dada de alta y
 * la dueña se entera para avisarle por otro medio (mismo criterio que
 * `recuperacion:solicitarCodigo`).
 */
export const invitar = action({
  args: { nombre: v.string(), email: v.string(), rol: ROL },
  returns: v.object({ id: v.id("users"), emailEnviado: v.boolean() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ id: Id<"users">; emailEnviado: boolean }> => {
    const actor = await ctx.runQuery(
      internal.usuarios._requirePropietariaActor,
      {},
    );

    const nombre = args.nombre.trim();
    if (nombre.length === 0) throw new ConvexError("El nombre es obligatorio");

    const email = normalizarEmail(args.email);
    if (email.length === 0 || !email.includes("@")) {
      throw new ConvexError("Indica un correo válido");
    }

    if (await ctx.runQuery(internal.usuarios._buscarPorEmail, { email })) {
      throw new ConvexError("Ya hay una persona con ese correo en el equipo.");
    }

    const { user } = await createAccount<DataModel>(ctx, {
      provider: "password",
      account: { id: email, secret: secretoAleatorio() },
      profile: { email, name: nombre, rol: args.rol, passwordPendiente: true },
    });

    const emailEnviado = await enviarInvitacion({
      para: email,
      nombre,
      rol: args.rol,
      invitadaPor: actor.name,
    });

    return { id: user._id, emailEnviado };
  },
});

/**
 * Contraseña de relleno para la cuenta recién invitada. No se muestra, no se
 * guarda en claro y no la conoce nadie: existe solo para que la credencial
 * exista. La persona pone la suya con el código que le llega al correo.
 */
function secretoAleatorio(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`;
}

/**
 * Escapa lo que va dentro del HTML del correo.
 *
 * Hace falta acá y no en `ResendOTP.ts`: aquel solo interpola su propio código
 * numérico, y este interpola NOMBRES que escribió una persona. Sin escapar, un
 * nombre con `<`, `>` o `&` rompe el marcado o mete HTML ajeno en el mensaje.
 * El `&` va primero o volvería a escapar lo que escapan los demás.
 */
function escapeHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const MAX_CUERPO_ERROR = 300;
const URL_RESEND = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

/**
 * Correo de bienvenida. Devuelve si salió o no; nunca lanza, porque un fallo de
 * envío no puede tumbar un alta que ya se hizo.
 *
 * ⚠️ NO lleva ningún enlace con token de un solo uso, a propósito. Los
 * antivirus y los gateways de correo corporativos PRE-VISITAN los enlaces para
 * escanearlos, así que un "magic link" quedaría consumido antes de que la
 * persona llegara a tocarlo y el clic de verdad fallaría con "enlace ya usado".
 * Acá solo hay un enlace plano al login (visitarlo no gasta nada) y el código
 * viaja aparte, como texto para teclear.
 */
async function enviarInvitacion(datos: {
  para: string;
  nombre: string;
  rol: Rol;
  invitadaPor?: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("GER-219: falta la variable de entorno RESEND_API_KEY");
    return false;
  }
  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) {
    console.error("GER-219: falta la variable de entorno SITE_URL");
    return false;
  }

  const urlLogin = `${siteUrl.replace(/\/$/, "")}/login`;
  const quien = datos.invitadaPor ?? "La dueña del CRM";
  const etiquetaRol = ETIQUETA_ROL[datos.rol];

  const texto = [
    `Hola ${datos.nombre}:`,
    "",
    `${quien} te dio de alta en Vibe CRM como "${etiquetaRol}".`,
    "",
    "Para entrar por primera vez tenés que crear tu contraseña:",
    `  1. Abrí ${urlLogin}`,
    '  2. Tocá "¿Olvidaste tu contraseña?" y escribí este correo',
    "  3. Te llega un código de 8 dígitos para elegir tu contraseña",
    "",
    "Si no esperabas este mensaje, podés ignorarlo.",
  ].join("\n");

  const html = [
    `<p>Hola ${escapeHtml(datos.nombre)}:</p>`,
    `<p>${escapeHtml(quien)} te dio de alta en Vibe CRM como <strong>${escapeHtml(etiquetaRol)}</strong>.</p>`,
    "<p>Para entrar por primera vez tenés que crear tu contraseña:</p>",
    "<ol>",
    `<li>Abrí <a href="${escapeHtml(urlLogin)}">${escapeHtml(urlLogin)}</a></li>`,
    "<li>Tocá «¿Olvidaste tu contraseña?» y escribí este correo</li>",
    "<li>Te llega un código de 8 dígitos para elegir tu contraseña</li>",
    "</ol>",
    "<p>Si no esperabas este mensaje, podés ignorarlo.</p>",
  ].join("");

  try {
    const respuesta = await fetch(URL_RESEND, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Vibe CRM <no-reply@red-24.com>",
        to: [datos.para],
        subject: "Te dieron de alta en Vibe CRM",
        text: texto,
        html,
      }),
    });

    // `fetch` NO lanza en 4xx/5xx: sin esto, un rechazo de Resend se tomaría
    // por envío correcto y diríamos que mandamos un correo que nunca salió.
    if (!respuesta.ok) {
      const cuerpo = (await respuesta.text().catch(() => "(sin cuerpo)")).slice(
        0,
        MAX_CUERPO_ERROR,
      );
      console.error(
        `GER-219: Resend rechazó la invitación (${respuesta.status}): ${cuerpo}`,
      );
      return false;
    }
    return true;
  } catch (causa) {
    // Solo el mensaje, recortado: nunca la traza ni las cabeceras (ahí va la
    // API key). `fetch` lanza ante DNS, TLS, red caída o el timeout de arriba.
    const detalle = (
      causa instanceof Error ? causa.message : String(causa)
    ).slice(0, MAX_CUERPO_ERROR);
    console.error(`GER-219: no se pudo contactar con Resend: ${detalle}`);
    return false;
  }
}
