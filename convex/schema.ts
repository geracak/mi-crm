import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

/**
 * Esquema del MVP — ver PRD "Datos" y TAL-6.
 *
 * Identidad: se usa la tabla `users` de Convex Auth (authTables), extendida con
 * el campo `rol` del negocio. El resto de authTables (authSessions, authAccounts,
 * …) se incluye tal cual con el spread. `autorId` / `responsableId` /
 * `completadoPorId` referencian `users`.
 *
 * Nota sobre Cliente.estado (Nuevo lead / En negociación / Ganado / Perdido):
 * es un valor CALCULADO a partir de las ventas del cliente, no se guarda ni se
 * edita a mano. Se deriva en el helper `estadoDe` (convex/clientes.ts):
 *   - sin ventas                    -> "nuevo_lead"
 *   - alguna venta "abierta"        -> "en_negociacion"
 *   - sin abiertas, alguna "ganada" -> "ganado"
 *   - todas "perdida"               -> "perdido"
 *
 * Las fechas (fecha, vence, fechaHecho) se guardan como string ISO "YYYY-MM-DD"
 * (sin hora), en zona local del usuario — el orden lexicográfico coincide con el
 * cronológico.
 */
export default defineSchema({
  ...authTables,

  // Tabla `users` de Convex Auth extendida con `rol`. Debe conservar los campos
  // e índice de authTables (perder el índice `email` o un campo rompe el login).
  // `rol` es opcional en el schema pero lo exige `requireUsuario`: solo el seed
  // y `usuarios:invitar` (vía createAccount con profile.rol) pueden provisionarlo.
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    rol: v.optional(v.union(v.literal("propietaria"), v.literal("comercial"))),
    // GER-219 — "esta cuenta todavía tiene la contraseña aleatoria que le puso el
    // sistema al invitarla, la persona nunca eligió una".
    //
    // ⚠️ Este valor NO se puede reconstruir mirando los datos, y por eso se
    // escribe desde la PRIMERA invitación en vez de añadirse después: una cuenta
    // recién invitada y una cuenta con contraseña propia tienen exactamente la
    // misma fila en `authAccounts` (provider "password"). Si el campo no
    // existiera desde el principio, no habría forma de distinguirlas y no
    // existiría backfill posible.
    //
    // Ciclo de vida completo (los dos extremos viven en esta entrega):
    //   lo ENCIENDE  `usuarios:invitar`, dentro del mismo insert que crea la fila
    //   lo APAGA     el wrapper `authorize` de `convex/auth.ts`, en el servidor,
    //                tras un `reset-verification` exitoso
    // `undefined` cuenta como `false`: los usuarios que ya existían (el seed)
    // tienen su contraseña puesta, así que no hace falta migrarlos.
    passwordPendiente: v.optional(v.boolean()),
    // ⚠️ VESTIGIAL — GER-242 lo dejó de leer y de escribir. NO usarlo.
    //
    // Era un ESPEJO del vencimiento del código, guardado en una transacción
    // distinta de la que lo crea, y su ausencia se interpretaba como "sin
    // restricción". Cualquier fallo entre las dos escrituras dejaba un código
    // de recuperación heredando el tope exterior de 24 h en vez de sus 15
    // minutos: fail-open en un control de seguridad. Ahora la ventana se DERIVA
    // al verificar, desde `authVerificationCodes._creationTime` y
    // `passwordPendiente` (ver `convex/auth.ts` y `emailUtils.ts`).
    //
    // Sigue declarado porque hay documentos en producción que lo tienen y
    // quitarlo del schema los invalidaría. Se limpian sus valores con
    // `authMaintenance:limpiarEspejoVencimiento` y, una vez limpios, retirar el
    // campo es un cambio aparte.
    //
    // Comentario original, conservado para entender de dónde venía:
    // GER-219 (E2) — cuándo vence el código de 8 dígitos que se le mandó por
    // última vez a esta persona.
    //
    // ⚠️ Existe porque la librería solo admite UN vencimiento por proveedor
    // (`provider.maxAge`, leído en `dist/server/implementation/signIn.js:61`) y
    // acá hacen falta dos: la INVITACIÓN dura 24 h (nadie abre el correo al
    // instante, y un "código vencido" sería lo primero que ve del producto)
    // y la RECUPERACIÓN dura 15 minutos (ahí sí hay una contraseña vigente que
    // proteger y quien lo pide está delante de la pantalla).
    //
    // `maxAge` queda en el máximo de los dos (24 h) como tope exterior, y el
    // vencimiento real de cada código se guarda acá al enviarlo
    // (`ResendOTP.sendVerificationRequest`) y se exige antes de cambiar la
    // contraseña (wrapper `authorize` de `convex/auth.ts`).
    //
    // `undefined` = sin restricción extra, solo el tope de la librería. Es el
    // estado de los códigos emitidos antes de esta entrega; no hace falta
    // migrar nada porque con el `maxAge` viejo (15 min) ya vencieron todos.
    codigoVenceEn: v.optional(v.number()),
  }).index("email", ["email"]),

  clientes: defineTable({
    nombre: v.string(),
    empresa: v.optional(v.string()),
    telefono: v.optional(v.string()),
    email: v.optional(v.string()),
    canalOrigen: v.optional(
      v.union(
        v.literal("web"),
        v.literal("redes"),
        v.literal("email"),
        v.literal("whatsapp"),
      ),
    ),
    nota: v.optional(v.string()),
    // "fecha de alta" = _creationTime (campo automático de Convex).
  })
    // GER-248 — `by_email` lo consulta `clientes:buscarPorEmail` para avisar de un
    // posible duplicado antes de guardar. El email se guarda ya normalizado
    // (`emailClienteOpcional`), así que la clave de búsqueda TAMBIÉN tiene que
    // normalizarse en el servidor o el índice no casa.
    //
    // Aquí vivía además un `searchIndex("search_nombre")` que no consultaba nadie:
    // la búsqueda de /clientes se hace en el navegador y cubre nombre Y email,
    // mientras que el índice solo cubría nombre. Se retiró en vez de cablearlo
    // porque habría sido un downgrade. Si algún día /clientes necesita paginar,
    // la búsqueda en servidor vuelve como feature propia — con su índice entonces.
    .index("by_email", ["email"]),

  interacciones: defineTable({
    clienteId: v.id("clientes"),
    fecha: v.string(),
    canal: v.union(
      v.literal("llamada"),
      v.literal("email"),
      v.literal("whatsapp"),
      v.literal("en_persona"),
    ),
    texto: v.string(),
    autorId: v.id("users"),
    // Compuesto: `order("desc")` sobre él da el historial ya ordenado por fecha
    // y, en empates del mismo día (fecha no lleva hora), por _creationTime.
  }).index("by_cliente_fecha", ["clienteId", "fecha"]),

  seguimientos: defineTable({
    clienteId: v.id("clientes"),
    accion: v.string(),
    vence: v.string(),
    responsableId: v.id("users"),
    hecho: v.boolean(),
    fechaHecho: v.optional(v.string()),
    // Quién marcó el seguimiento como hecho — solo esa persona puede deshacerlo.
    completadoPorId: v.optional(v.id("users")),
  })
    .index("by_hecho_vence", ["hecho", "vence"])
    // Los pendientes de un cliente se ordenan por cuándo VENCEN, y los completados
    // por cuándo se HICIERON: son campos distintos, así que hacen falta dos índices.
    // Con uno solo por `vence`, truncar los completados descartaría un seguimiento
    // que venció hace meses pero se cerró hoy — justo el que encabeza el historial.
    // Indexar `fechaHecho` (opcional en el schema) es seguro: `marcarHecho` escribe
    // `hecho: true` y `fechaHecho` juntos, y `deshacer` los limpia juntos.
    .index("by_cliente_hecho_vence", ["clienteId", "hecho", "vence"])
    .index("by_cliente_hecho_fechaHecho", ["clienteId", "hecho", "fechaHecho"]),

  ventas: defineTable({
    clienteId: v.id("clientes"),
    concepto: v.string(),
    // Importe en la moneda del negocio (dólares), con hasta dos decimales. El
    // backend lo normaliza al guardarlo; las sumas se hacen en centavos.
    importe: v.number(),
    estado: v.union(
      v.literal("abierta"),
      v.literal("ganada"),
      v.literal("perdida"),
    ),
    fecha: v.string(),
    autorId: v.id("users"),
    // Compuesto por la misma razón que en `interacciones`: el historial de la
    // ficha ordena por `fecha` y se trunca con `take`, así que el índice tiene
    // que ordenar por ese campo o se descartarían filas equivocadas. Sirve
    // también para consultar solo por `clienteId` (prefijo), que es lo que hace
    // `estadoDe`. No hay `by_estado`: /ventas necesita los cuatro contadores a
    // la vez, así que lee la tabla entera una vez y filtra en memoria.
  }).index("by_cliente_fecha", ["clienteId", "fecha"]),

  // GER-239 — Límite de solicitudes de código de recuperación, aparte del
  // límite de INTENTOS de verificación que ya trae `@convex-dev/auth`
  // (`authRateLimits`, 10/hora). Sin esto, nada impedía pedir códigos nuevos
  // en bucle: cada solicitud dispara un correo real por Resend. Se indexa por
  // el correo TECLEADO (normalizado), exista o no la cuenta — así el límite en
  // sí no delata qué correos tienen acceso.
  recuperacionThrottle: defineTable({
    email: v.string(),
    ultimaSolicitud: v.number(),
  }).index("by_email", ["email"]),
});
