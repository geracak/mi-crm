import { v, ConvexError } from "convex/values";
import {
  query,
  action,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { createAccount, invalidateSessions } from "@convex-dev/auth/server";
import { api, internal } from "./_generated/api";
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
 * Resuelve un correo a su fila de `users`.
 *
 * ⚠️ Busca PRIMERO por `authAccounts.providerAccountId` y solo después por
 * `users.email`, y ese orden importa: el campo por el que el login identifica
 * a alguien es el de la credencial, no el del perfil. En este proyecto los dos
 * ya divergieron una vez de verdad (ver `authMaintenance.ts`), y mirar solo
 * `users.email` haría que a una cuenta migrada no le llegara su propio código.
 */
async function usuarioPorEmail(
  ctx: QueryCtx,
  email: string,
): Promise<Doc<"users"> | null> {
  const cuenta = await ctx.db
    .query("authAccounts")
    .withIndex("providerAndAccountId", (q) =>
      q.eq("provider", "password").eq("providerAccountId", email),
    )
    .first();
  if (cuenta !== null) return await ctx.db.get(cuenta.userId);

  return await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .first();
}

/**
 * GER-219 (E2) — Lo que `ResendOTP.sendVerificationRequest` necesita para
 * decidir QUÉ correo mandar: el de invitación (con el código, para quien nunca
 * tuvo contraseña) o el de recuperación (para quien sí la tiene).
 *
 * Devuelve `null` si el correo no corresponde a ninguna cuenta. Quien llama
 * debe tratar ese caso como "recuperación", nunca como invitación: es interna,
 * pero el criterio de no delatar qué correos existen se sostiene igual.
 */
export const _datosParaCorreo = internalQuery({
  args: { email: v.string() },
  returns: v.union(
    v.object({
      pendiente: v.boolean(),
      name: v.optional(v.string()),
      // Ya traducida acá: `ETIQUETA_ROL` es la única fuente de verdad de cómo
      // se llama cada rol de cara a la gente, y duplicar ese mapa en el módulo
      // del correo lo dejaría derivar en silencio.
      etiquetaRol: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const u = await usuarioPorEmail(ctx, normalizarEmail(args.email));
    if (u === null) return null;
    return {
      pendiente: u.passwordPendiente === true,
      name: u.name,
      etiquetaRol: u.rol === undefined ? undefined : ETIQUETA_ROL[u.rol],
    };
  },
});

/**
 * GER-219 (E2) — Guarda cuándo vence el código que se acaba de enviar.
 *
 * La escribe `ResendOTP.sendVerificationRequest` (que sabe si el código es de
 * invitación o de recuperación) y la lee el wrapper `authorize` de
 * `convex/auth.ts` antes de dejar cambiar la contraseña. Ver el comentario de
 * `codigoVenceEn` en el schema para por qué no basta con `provider.maxAge`.
 */
export const _fijarVencimientoCodigo = internalMutation({
  args: { email: v.string(), venceEn: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const u = await usuarioPorEmail(ctx, normalizarEmail(args.email));
    if (u === null) return null;
    await ctx.db.patch(u._id, { codigoVenceEn: args.venceEn });
    return null;
  },
});

/**
 * GER-219 (E2) — Lee el vencimiento del código vigente. La usa el wrapper
 * `authorize` de `convex/auth.ts`.
 */
export const _vencimientoCodigo = internalQuery({
  args: { email: v.string() },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, args) => {
    const u = await usuarioPorEmail(ctx, normalizarEmail(args.email));
    return u?.codigoVenceEn ?? null;
  },
});

/**
 * GER-219 (E2) — Qué le toca hacer a este correo en el login. PÚBLICA y SIN
 * autenticación a propósito: se consulta antes de iniciar sesión.
 *
 * ⚠️ Diseñada para NO ser un oráculo de enumeración: `"normal"` cubre a la vez
 * "cuenta con contraseña puesta" y "ese correo no existe". Las dos respuestas
 * llevan a la misma pantalla (pedir contraseña) y al mismo error si falla, así
 * que probar correos al azar no dice cuáles tienen acceso al CRM.
 *
 * Lo único que sí distingue es `"pendiente"`: revela que ese correo fue
 * invitado y todavía no activó su cuenta. Es una fuga aceptada y deliberada —
 * sin ella no hay forma de dejar de decirle "¿olvidaste tu contraseña?" a
 * alguien que nunca tuvo una, que es justo el problema que esta entrega
 * resuelve. No revela nada explotable: para entrar sigue haciendo falta el
 * código que solo llega a ese buzón.
 */
export const estadoCuenta = query({
  args: { email: v.string() },
  returns: v.union(v.literal("pendiente"), v.literal("normal")),
  handler: async (ctx, args) => {
    const u = await usuarioPorEmail(ctx, normalizarEmail(args.email));
    return u !== null && u.passwordPendiente === true ? "pendiente" : "normal";
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
 *
 * GER-219 (E2) — El correo lo manda el MISMO flujo `reset` que usa la
 * recuperación, en vez de un envío propio. Es lo que hace que la invitación
 * lleve el código de 8 dígitos dentro: solo ese flujo genera un código válido
 * (`authVerificationCodes`), y `ResendOTP.sendVerificationRequest` ve que la
 * cuenta está `passwordPendiente` y manda el texto de bienvenida en lugar del
 * de recuperación. Antes se mandaba un correo aparte que le pedía tocar
 * "¿Olvidaste tu contraseña?" — falso para alguien que nunca tuvo una.
 */
export const invitar = action({
  args: { nombre: v.string(), email: v.string(), rol: ROL },
  returns: v.object({ id: v.id("users"), emailEnviado: v.boolean() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ id: Id<"users">; emailEnviado: boolean }> => {
    // Autoriza y nada más: quién invita ya no se interpola en el correo, porque
    // el texto lo arma `ResendOTP` y ahí solo llega el destinatario.
    await ctx.runQuery(internal.usuarios._requirePropietariaActor, {});

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

    // Dispara el código por el flujo `reset`. Va DESPUÉS de `createAccount` y
    // no puede ir antes: `reset` exige que la credencial ya exista
    // (`dist/providers/Password.js:92-95` hace `retrieveAccount` primero).
    //
    // Cualquier fallo se reporta como "no salió el correo" y NO revierte el
    // alta: la persona ya está en el equipo y la dueña puede reenviarle el
    // código, mientras que deshacer el alta dejaría una cuenta a medio crear.
    let emailEnviado = true;
    try {
      await ctx.runAction(api.auth.signIn, {
        provider: "password",
        params: { email, flow: "reset" },
      });
    } catch (err) {
      console.error(
        "GER-219: alta creada pero no se pudo enviar la invitación:",
        err instanceof Error ? err.message : String(err),
      );
      emailEnviado = false;
    }

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
