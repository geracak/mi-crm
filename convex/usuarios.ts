import { v, ConvexError } from "convex/values";
import {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import {
  createAccount,
  invalidateSessions,
  getAuthSessionId,
  retrieveAccount,
  modifyAccountCredentials,
} from "@convex-dev/auth/server";
import { api, internal } from "./_generated/api";
import { requireUsuario, requirePropietaria } from "./authz";
import { normalizarEmail, ventanaCodigoMs } from "./emailUtils";
import { faltaConfigDeEnvio } from "./ResendOTP";

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
      // GER-242 — Para que la invalidación del código pueda comprobar que el
      // hash apunta a la cuenta de ESTE envío. Sale de la consulta que ya se
      // hace acá; pedirla aparte sería un viaje de más.
      accountId: v.union(v.id("authAccounts"), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const email = normalizarEmail(args.email);
    const u = await usuarioPorEmail(ctx, email);
    if (u === null) return null;

    // `take(2)`: `providerAndAccountId` no es único. Ante ambigüedad se
    // devuelve `null` en vez de elegir una cuenta al azar — quien reciba esto
    // simplemente se queda sin la comprobación extra, nunca con una equivocada.
    const cuentas = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "password").eq("providerAccountId", email),
      )
      .take(2);

    return {
      pendiente: u.passwordPendiente === true,
      name: u.name,
      etiquetaRol: u.rol === undefined ? undefined : ETIQUETA_ROL[u.rol],
      accountId: cuentas.length === 1 ? cuentas[0]._id : null,
    };
  },
});

/**
 * GER-242 — Estado REAL del código de 8 dígitos de una cuenta.
 *
 * ⚠️ Esta función es el corazón del arreglo de la auditoría. Antes el
 * vencimiento se guardaba en `users.codigoVenceEn`, un ESPEJO escrito en una
 * transacción distinta de la que crea el código. Cualquier fallo entre las dos
 * dejaba los datos divergentes, y como la ausencia del espejo se interpretaba
 * como "sin restricción", la divergencia era FAIL-OPEN: un código de
 * recuperación heredaba el tope exterior de 24 h en vez de sus 15 minutos.
 *
 * Ahora no hay espejo. La ventana se DERIVA de dos cosas que no pueden
 * desincronizarse porque ninguna se escribe para esto:
 *
 *   `authVerificationCodes._creationTime`  cuándo nació ESTE código
 *   `users.passwordPendiente`             si la cuenta está en activación
 *
 * Sin fila de código no hay nada que verificar, así que la ausencia es
 * fail-closed por construcción y no por convención.
 */
type EstadoCodigo =
  /** Hay exactamente un código y estos son sus datos. */
  | { tipo: "ok"; creadoEn: number; pendiente: boolean }
  /** Más de una fila para la misma cuenta: no se elige ninguna al azar. */
  | { tipo: "ambiguo" }
  /** No hay código vivo. `pendiente` sirve igual para decidir la pantalla. */
  | { tipo: "sin-codigo"; pendiente: boolean };

/**
 * Función normal (no query) para que corra DENTRO de la transacción de quien
 * llame — mismo criterio que `validarActualizacion`.
 */
async function estadoDelCodigo(
  ctx: QueryCtx,
  emailSinNormalizar: string,
): Promise<EstadoCodigo> {
  const email = normalizarEmail(emailSinNormalizar);
  const usuario = await usuarioPorEmail(ctx, email);
  const pendiente = usuario?.passwordPendiente === true;

  // `providerAndAccountId` NO es único (Convex no tiene índices únicos), así
  // que se comprueba en vez de asumir. Mismo patrón que `_buscarPorEmail`.
  const cuentas = await ctx.db
    .query("authAccounts")
    .withIndex("providerAndAccountId", (q) =>
      q.eq("provider", "password").eq("providerAccountId", email),
    )
    .take(2);
  if (cuentas.length > 1) return { tipo: "ambiguo" };
  if (cuentas.length === 0) return { tipo: "sin-codigo", pendiente };

  const codigos = await ctx.db
    .query("authVerificationCodes")
    .withIndex("accountId", (q) => q.eq("accountId", cuentas[0]._id))
    .take(2);
  if (codigos.length > 1) return { tipo: "ambiguo" };
  if (codigos.length === 0) return { tipo: "sin-codigo", pendiente };

  return { tipo: "ok", creadoEn: codigos[0]._creationTime, pendiente };
}

/** Lo que `convex/auth.ts` necesita para decidir si un código sigue sirviendo. */
export const _estadoCodigo = internalQuery({
  args: { email: v.string() },
  returns: v.union(
    v.object({
      tipo: v.literal("ok"),
      creadoEn: v.number(),
      pendiente: v.boolean(),
    }),
    v.object({ tipo: v.literal("ambiguo") }),
    v.object({ tipo: v.literal("sin-codigo"), pendiente: v.boolean() }),
  ),
  handler: async (ctx, args) => await estadoDelCodigo(ctx, args.email),
});

/**
 * GER-242 — Invalida el código de UN envío concreto, identificado por el hash
 * de su token.
 *
 * ⚠️ Por qué por hash y no por cuenta: la librería crea el código en una
 * mutación y lo envía desde una acción aparte, así que dos solicitudes se
 * pueden intercalar. Si el borrado fuera por `accountId`, un intento fallido
 * borraría el código de otro intento que SÍ se entregó. El hash ata la fila a
 * este envío: si otro ya la reemplazó, no coincide con ninguna y no se borra
 * nada — que es justo lo correcto.
 *
 * El formato es el de la librería, verificado en su código:
 * `generateUniqueVerificationCode` guarda `code: await sha256(code)` y ese
 * `sha256` es `encodeHexLowerCase(rawSha256(...))`
 * (`dist/server/implementation/utils.js:9-11`).
 *
 * ⚠️ El índice `code` NO es único a nivel de schema (la librería lo consulta
 * con `.unique()`, pero Convex no lo impone). Ante una colisión no se elige una
 * fila al azar: no se borra nada y se informa, igual que en el resto de las
 * guardas de ambigüedad del proyecto.
 *
 * Devuelve qué pasó, para que quien llama pueda distinguir "lo borré" de "ya no
 * estaba" sin tener que adivinarlo.
 */
export const _invalidarCodigoPorHash = internalMutation({
  args: { hash: v.string(), accountId: v.optional(v.id("authAccounts")) },
  returns: v.union(
    v.literal("borrado"),
    v.literal("no-estaba"),
    v.literal("ambiguo"),
  ),
  handler: async (ctx, args) => {
    const filas = await ctx.db
      .query("authVerificationCodes")
      .withIndex("code", (q) => q.eq("code", args.hash))
      .take(2);
    if (filas.length > 1) return "ambiguo";
    if (filas.length === 0) return "no-estaba";

    // Defensa extra: si quien llama sabe a qué cuenta pertenecía su envío, el
    // hash tiene además que apuntar a esa cuenta. Una colisión de hash con otra
    // cuenta es inverosímil, pero no borrar por ella cuesta una comparación.
    if (args.accountId !== undefined && filas[0].accountId !== args.accountId) {
      return "ambiguo";
    }

    await ctx.db.delete(filas[0]._id);
    return "borrado";
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
 * Lo único que sí distingue es la invitación sin activar: revela que ese correo
 * fue invitado y todavía no activó su cuenta. Es una fuga aceptada y deliberada
 * — sin ella no hay forma de dejar de decirle "¿olvidaste tu contraseña?" a
 * alguien que nunca tuvo una, que es justo el problema que esta entrega
 * resuelve. No revela nada explotable: para entrar sigue haciendo falta el
 * código que solo llega a ese buzón.
 *
 * ⚠️ Distingue DOS estados de invitación, y esa diferencia es un arreglo, no un
 * detalle: mandar un código nuevo cuando el de la invitación seguía vivo hacía
 * que la persona recibiera dos correos casi juntos y que el primero — el de
 * bienvenida, que le dice "tu código es X" — quedara invalidado por el segundo.
 * La librería solo mantiene un código por cuenta, así que reenviar SIEMPRE
 * pisaba el que acababa de llegar.
 *
 *   `activacion-lista`     hay un código de invitación todavía vigente; el
 *                          login NO debe mandar nada, solo pedirlo
 *   `activacion-vencida`   no queda código útil; hay que mandar uno nuevo
 *
 * GER-242 — `activacion-lista` se decide mirando el CÓDIGO que existe ahora, no
 * un vencimiento guardado aparte. Con el espejo, un reenvío cuyo correo fallaba
 * dejaba el vencimiento viejo apuntando al futuro mientras la librería ya había
 * reemplazado el código: la pantalla afirmaba que había un código utilizable en
 * el buzón cuando el viejo estaba borrado y el nuevo no había salido.
 */
export const estadoCuenta = query({
  args: { email: v.string() },
  returns: v.union(
    v.literal("activacion-lista"),
    v.literal("activacion-vencida"),
    v.literal("normal"),
  ),
  handler: async (ctx, args) => {
    const estado = await estadoDelCodigo(ctx, args.email);

    // Ambiguo se trata como "normal" a propósito: es un estado roto de datos y
    // la pantalla de contraseña es la que menos promete. La ambigüedad la
    // rechaza de verdad el control de `convex/auth.ts` al verificar.
    if (estado.tipo === "ambiguo") return "normal";
    if (!estado.pendiente) return "normal";
    if (estado.tipo === "sin-codigo") return "activacion-vencida";

    return Date.now() - estado.creadoEn <= ventanaCodigoMs(estado.pendiente)
      ? "activacion-lista"
      : "activacion-vencida";
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

      // ⚠️ GER-242 — Invalidar el código pendiente, en ESTA transacción.
      //
      // `ResendOTP.authorize` valida el código contra `providerAccountId`, que
      // se acaba de mover al correo nuevo. Sin borrarlo, el código que se envió
      // al buzón VIEJO pasaría a autorizar la activación bajo el correo NUEVO
      // durante el resto de su ventana — o sea que quien controle el buzón
      // viejo puede fijar la contraseña de esa cuenta. Es exactamente el acceso
      // que cambiar el correo pretende cortar.
      //
      // Va junto al patch y no en una llamada aparte a propósito: dos
      // transacciones dejarían un instante con el identificador ya movido y el
      // código viejo todavía válido.
      //
      // Acá SÍ se borra por `accountId` (a diferencia de
      // `_invalidarCodigoPorHash`, que se ata al token): la intención es
      // distinta. Allá es "limpiá lo tuyo sin pisar lo ajeno"; acá es "no debe
      // quedar NINGÚN código de esta cuenta", que es la invariante que revoca
      // el acceso del buzón anterior.
      const codigos = await ctx.db
        .query("authVerificationCodes")
        .withIndex("accountId", (q) => q.eq("accountId", cuentasPassword[0]._id))
        .collect();
      for (const codigo of codigos) {
        await ctx.db.delete(codigo._id);
      }
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

    // GER-242 (B1) — Los seguimientos PENDIENTES pasan a quien ejecuta el
    // borrado. Sin esto quedaban apuntando a un usuario inexistente y se
    // mostraban sin nombre (`responsableNombre: responsable?.name` en
    // `seguimientos.ts`), o sea trabajo vivo que ya no era de nadie visible.
    //
    // Los completados NO se tocan: son historia y decir que los hizo otra
    // persona sería falsear el registro. Su nombre en blanco es el coste
    // aceptado de haber quitado a alguien del equipo.
    //
    // Escala MVP: se recorren todos los pendientes del negocio y se filtra en
    // memoria porque no hay índice por responsable. Mismo criterio que
    // `contarPropietarias` y `listar`.
    const pendientes = await ctx.db
      .query("seguimientos")
      .withIndex("by_hecho_vence", (q) => q.eq("hecho", false))
      .collect();
    for (const s of pendientes) {
      if (s.responsableId === args.id) {
        await ctx.db.patch(s._id, { responsableId: args.actorId });
      }
    }

    // Todas sus credenciales, de cualquier proveedor (password y google).
    const cuentas = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", args.id))
      .collect();
    for (const cuenta of cuentas) {
      // GER-242 (M3) — Los códigos van ANTES que su cuenta. Al revés quedarían
      // filas apuntando a un `accountId` que ya no existe, imposibles de
      // localizar después salvo barriendo la tabla entera.
      const codigos = await ctx.db
        .query("authVerificationCodes")
        .withIndex("accountId", (q) => q.eq("accountId", cuenta._id))
        .collect();
      for (const codigo of codigos) {
        await ctx.db.delete(codigo._id);
      }
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
    // GER-242 — Config primero: si falta, se corta ANTES de que la librería
    // genere el código. Sin esto quedaba una fila de `authVerificationCodes` de
    // un código que nadie recibió, y `estadoCuenta` afirmaba que había uno
    // utilizable en el buzón. Ver `faltaConfigDeEnvio` para por qué no se puede
    // limpiar desde dentro del envío.
    const falta = faltaConfigDeEnvio();
    if (falta !== null) {
      console.error(
        `GER-242: alta creada sin invitación, falta la variable ${falta}`,
      );
      return { id: user._id, emailEnviado: false };
    }

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

// ---------------------------------------------------------------------------
// GER-218 — Perfil / Mi cuenta. Todo lo de abajo lo ejecuta cada persona SOBRE
// SÍ MISMA: el id sale siempre de la sesión, nunca de los argumentos.
// ---------------------------------------------------------------------------

/**
 * GER-218 — Longitud mínima de la contraseña. Esta constante es LA AUTORIDAD.
 *
 * ⚠️ No la valida la librería por este camino. `modifyAccountCredentials` solo
 * busca la fila y la hashea (`dist/server/implementation/mutations/
 * modifyAccount.js:8-27` → `.../provider.js:1-10`); el mínimo de 8 de
 * `@convex-dev/auth` vive ÚNICAMENTE dentro del `authorize` del provider
 * Password y solo para los flujos `signUp` y `reset-verification`
 * (`dist/providers/Password.js:44-55` y `:171-174`), que esta ruta no atraviesa.
 *
 * El cliente tiene su propia copia en `src/lib/password.ts` para avisar antes de
 * enviar; es UX, no control. Si cambia una, cambiar la otra.
 */
const MIN_PASSWORD = 8;

/**
 * GER-218 — Corrige tu propio nombre desde /cuenta.
 *
 * Lo puede hacer cualquiera con acceso, sin pasar por la dueña: el nombre no da
 * permisos, solo firma interacciones y ventas. El correo NO se toca acá (mover
 * la identidad es lo que hace `usuarios:actualizar`, restringido a la dueña).
 */
export const actualizarNombre = mutation({
  args: { nombre: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const yo = await requireUsuario(ctx);

    const nombre = args.nombre.trim();
    if (nombre.length === 0) throw new ConvexError("El nombre es obligatorio");

    // Sin cambios, sin escritura: evita invalidar las queries suscritas al
    // usuario por guardar exactamente lo mismo que ya había.
    if (nombre === yo.name) return null;

    await ctx.db.patch(yo._id, { name: nombre });
    return null;
  },
});

/**
 * GER-218 — La credencial de contraseña de QUIEN LLAMA, para `cambiarPassword`.
 *
 * ⚠️ Se lee de `authAccounts`, NO de `users.email`. El login por contraseña
 * identifica la cuenta por `providerAccountId` y en este proyecto los dos
 * valores ya divergieron una vez de verdad (ver
 * `authMaintenance.ts::migrarIdentificadorPassword`): usar el correo del perfil
 * podría apuntar a una credencial que no es la suya, o a ninguna.
 *
 * Los dos casos degenerados salen con un mensaje que la persona pueda entender,
 * nunca con un crash. `take(2)` y rechazo en vez de `first()`: no se elige una
 * fila al azar, mismo criterio que `validarActualizacion` y `_actualizarFilas`.
 */
export const _credencialPropia = internalQuery({
  args: {},
  returns: v.object({
    userId: v.id("users"),
    providerAccountId: v.string(),
  }),
  handler: async (ctx) => {
    const yo = await requireUsuario(ctx);

    const cuentas = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) =>
        q.eq("userId", yo._id).eq("provider", "password"),
      )
      .take(2);

    if (cuentas.length === 0) {
      throw new ConvexError(
        "Tu cuenta no tiene una contraseña que cambiar. Cerrá sesión y usá «¿Olvidaste tu contraseña?» para crear una.",
      );
    }
    if (cuentas.length > 1) {
      throw new ConvexError(
        "Esa cuenta tiene más de una credencial de contraseña. Abortado sin cambiar nada.",
      );
    }

    return { userId: yo._id, providerAccountId: cuentas[0].providerAccountId };
  },
});

/**
 * GER-218 — Cambiá tu propia contraseña desde /cuenta.
 *
 * Es una `action` porque `retrieveAccount` y `modifyAccountCredentials` llaman
 * por dentro a `ctx.runMutation("auth:store")` y eso no se puede hacer desde una
 * mutation.
 *
 * ⚠️ EL ORDEN ES EL CONTRATO. Verificar → revocar → escribir.
 *
 * `invalidateSessions` y `modifyAccountCredentials` son transacciones separadas,
 * no atómicas entre sí (dos llamadas distintas a `auth:store`). Si se escribiera
 * primero, un fallo entre ambas dejaría la contraseña YA rotada y las demás
 * sesiones vivas — lo contrario exacto de lo que promete la pantalla, y encima
 * con la UI diciendo que la operación falló. Al revés, el peor caso es "se
 * cerraron sesiones de más y la contraseña sigue siendo la vieja": molesto,
 * nunca inseguro. Es el mismo criterio ya sellado en `actualizar` (más arriba en
 * este archivo).
 *
 * Y la verificación va ANTES de revocar: si no, teclear mal la contraseña sería
 * una forma trivial de echar a alguien de todos sus dispositivos.
 *
 * ⚠️ Residual conocido y aceptado (GER-244): entre revocar y escribir queda una
 * ventana en la que un login con la contraseña VIEJA crea una sesión que ninguna
 * de las dos operaciones alcanza. Cerrarla exige atomicidad que la librería hoy
 * no ofrece.
 *
 * ⚠️ Qué revoca exactamente `invalidateSessions`, para no prometer de más: borra
 * la fila de `authSessions` y sus refresh tokens, así que el otro dispositivo no
 * puede renovar y queda fuera. Pero el ACCESS TOKEN que ya tenga en la mano es un
 * JWT sin estado, válido hasta que caduque —1 hora por defecto
 * (`implementation/tokens.js:4`)— porque `ctx.auth.getUserIdentity()` verifica la
 * firma y NO consulta `authSessions`. O sea: el acceso se corta en ≤1 h, no en el
 * instante. No es algo que introduzca esta pantalla: `usuarios:actualizar` tiene
 * exactamente la misma propiedad. (`eliminar` es el caso distinto: al borrar la
 * fila de `users`, `requireUsuario` corta en el acto.)
 */
export const cambiarPassword = action({
  args: { passwordActual: v.string(), passwordNueva: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    // La sesión actual es la única que NO se revoca. Sin este id habría que
    // pasar `except` vacío y el cambio de contraseña te echaría a vos mismo.
    // Con sesión válida esto nunca es null (lee el mismo `getUserIdentity` que
    // `requireUsuario`); la comprobación es defensa en profundidad.
    const sessionId = await getAuthSessionId(ctx);
    if (sessionId === null) {
      throw new ConvexError("Tu sesión expiró. Volvé a entrar.");
    }

    // Antes de producir NINGÚN efecto. Ver `MIN_PASSWORD`: acá no hay red debajo.
    if (args.passwordNueva.length < MIN_PASSWORD) {
      throw new ConvexError(
        `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`,
      );
    }
    if (args.passwordNueva === args.passwordActual) {
      throw new ConvexError("La contraseña nueva tiene que ser distinta.");
    }

    const credencial = await ctx.runQuery(
      internal.usuarios._credencialPropia,
      {},
    );

    // Verifica la contraseña actual. `retrieveAccount` aplica por dentro el
    // límite de intentos de la librería (10 fallos/hora sobre esta cuenta:
    // `isSignInRateLimited` → `Provider.verify` → `recordFailedSignIn`), así que
    // el mismo control que protege el login protege esto.
    //
    // Devuelve un `Error` PELADO con un código dentro (no un `ConvexError`), así
    // que sin este catch el cliente vería "Server Error" y nada más.
    const cuenta = await retrieveAccount<DataModel>(ctx, {
      provider: "password",
      account: {
        id: credencial.providerAccountId,
        secret: args.passwordActual,
      },
    }).catch((error: unknown) => {
      // ⚠️ Solo el mensaje, NUNCA el error entero ni los args: por ahí viajan
      // las dos contraseñas en claro (misma regla que el wrapper de `auth.ts`).
      const codigo = error instanceof Error ? error.message : String(error);
      if (codigo.includes("TooManyFailedAttempts")) {
        throw new ConvexError({
          mensaje:
            "Demasiados intentos fallidos. Probá de nuevo dentro de una hora.",
        });
      }
      if (codigo.includes("InvalidSecret")) {
        // El `codigo` deja que la pantalla ofrezca la salida a quien entra con
        // Google y nunca eligió contraseña: no hay ningún dato que permita
        // distinguirla de antemano (`passwordPendiente` se apaga al entrar por
        // Google — ver `apagarPendienteSiGoogle` en `auth.ts`), así que el
        // fallo de la contraseña actual es el único momento donde se sabe.
        throw new ConvexError({
          codigo: "PASSWORD_ACTUAL_INCORRECTA",
          mensaje: "La contraseña actual no es correcta.",
        });
      }
      console.error("GER-218: no se pudo verificar la contraseña:", codigo);
      throw new ConvexError({
        mensaje: "No pudimos verificar tu contraseña actual.",
      });
    });

    // La cuenta se resolvió por `providerAccountId`, no por la sesión. Que
    // coincida con quien llama es invariante del paso anterior — pero es la
    // comprobación que separa "cambio mi contraseña" de "cambio la de otro" si
    // esa invariante se rompiera por deuda de datos, así que se afirma explícita
    // y ANTES de revocar o escribir nada.
    //
    // ⚠️ `cuenta.user` puede ser `null`: `retrieveAccountWithCredentialsImpl`
    // hace `ctx.db.get(existingAccount.userId)` sin comprobar el resultado
    // (`mutations/retrieveAccountWithCredentials.js:35`), así que una
    // credencial huérfana (fila en `authAccounts` sin su `users` — la misma
    // clase de deuda de datos que ya documenta `_buscarPorEmail` más arriba)
    // NO tira un error de la librería: hay que comprobarlo antes de leer
    // `.user._id`, o el fallo sale como TypeError opaco en vez de un mensaje
    // legible.
    if (cuenta.user === null || cuenta.user._id !== credencial.userId) {
      console.error(
        "GER-218: la credencial resuelta no pertenece a quien llama (o está huérfana); abortado.",
      );
      throw new ConvexError("No pudimos verificar tu contraseña actual.");
    }

    // REVOCAR primero (ver el comentario de arriba), preservando la sesión desde
    // la que se está haciendo el cambio.
    await invalidateSessions<DataModel>(ctx, {
      userId: credencial.userId,
      except: [sessionId],
    });

    // …y escribir después.
    await modifyAccountCredentials<DataModel>(ctx, {
      provider: "password",
      account: {
        id: credencial.providerAccountId,
        secret: args.passwordNueva,
      },
    });

    return null;
  },
});
