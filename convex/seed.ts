import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { DEMO_USER_EMAIL } from "./users";

// ⚠️ DEV-ONLY. Ambas mutations exigen la variable de entorno
// ALLOW_DEV_SEED="true" configurada en el deployment (`npx convex env set
// ALLOW_DEV_SEED true`, ver .env.local.example) - sin ella, cualquier
// llamada falla sin importar quién la invoque, no depende de que nadie
// respete el comentario.
//
// Límite real de esta guardia (no es autorización): NO es un control de
// acceso por usuario/rol - es un interruptor a nivel de deployment. Mientras
// ALLOW_DEV_SEED esté seteado en un deployment, cualquiera con la URL de ese
// deployment puede invocar estas mutations (no hay auth todavía - GER-217).
// Mitigación aceptada para este alcance: nunca setear ALLOW_DEV_SEED en un
// deployment de producción ni en uno compartido/expuesto públicamente -
// solo en deployments locales/efímeros de desarrollo. Autorización real por
// usuario llega con GER-217.
//
// ⛔ ANTES DE CUALQUIER DEPLOYMENT PRODUCTIVO/COMPARTIDO (bloqueante, no
// opcional): eliminar este archivo (convex/seed.ts) del deployment, o - si
// GER-217 (auth real) ya está resuelto - reemplazar assertDevMutationsAllowed
// por una verificación de rol/sesión real. No alcanza con dejar
// ALLOW_DEV_SEED sin setear: mientras el archivo exista en el deployment,
// sigue siendo código desplegado que depende de disciplina de proceso, no de
// un control técnico por-deployment. Este seed.ts es intencionalmente
// desechable: existe solo para poblar datos de prueba en desarrollo local
// mientras no hay pantallas de alta de clientes/seguimientos (GER-27/28) ni
// login (GER-217).
function assertDevMutationsAllowed() {
  if (process.env.ALLOW_DEV_SEED !== "true") {
    throw new Error(
      "Mutation dev-only deshabilitada: falta ALLOW_DEV_SEED=true en este deployment.",
    );
  }
}

const DIA_MS = 24 * 60 * 60 * 1000;

export const seedDemoData = mutation({
  args: {},
  handler: async (ctx) => {
    assertDevMutationsAllowed();
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", DEMO_USER_EMAIL))
      .unique();
    if (existing) {
      return { skipped: true, reason: "El dataset demo ya existe" };
    }

    const marta = await ctx.db.insert("users", {
      name: "Marta",
      email: DEMO_USER_EMAIL,
      rol: "propietaria",
      isDemo: true,
    });

    const nombresClientes = [
      { nombre: "Juan Pérez", estado: "activo" },
      { nombre: "Ana Gómez", estado: "nuevo" },
      { nombre: "Carlos Ruiz", estado: "activo" },
      { nombre: "Lucía Fernández", estado: "en negociación" },
      { nombre: "Martín Silva", estado: "activo" },
      { nombre: "Sofía Torres", estado: "nuevo" },
      { nombre: "Diego Molina", estado: "en negociación" },
    ];

    const clienteIds = [];
    for (const c of nombresClientes) {
      clienteIds.push(
        await ctx.db.insert("clientes", {
          nombre: c.nombre,
          estado: c.estado,
          isDemo: true,
        }),
      );
    }

    const ahora = Date.now();
    const acciones = [
      "Llamar para confirmar pedido",
      "Enviar propuesta",
      "Seguimiento post-venta",
      "Coordinar reunión",
      "Confirmar datos de facturación",
    ];

    const offsetsDias = [-3, -1, 0, 0, 1, 3, 7, -5, 0, 2, -2, 5];
    for (let i = 0; i < offsetsDias.length; i++) {
      const cliente = clienteIds[i % clienteIds.length];
      await ctx.db.insert("seguimientos", {
        clienteId: cliente,
        accion: acciones[i % acciones.length],
        vence: ahora + offsetsDias[i] * DIA_MS,
        hecho: false,
        responsableId: marta,
        isDemo: true,
      });
    }

    return { skipped: false, userId: marta, clientes: clienteIds.length };
  },
});

// Mecanismo explícito para probar el gating de rol (ej. /equipo) sin login
// real: cambia el rol del ÚNICO usuario que `users.getCurrent` puede ver.
// No crea usuarios nuevos ni toca ningún otro campo.
export const setDemoUserRole = mutation({
  args: { rol: v.union(v.literal("propietaria"), v.literal("comercial")) },
  handler: async (ctx, { rol }) => {
    assertDevMutationsAllowed();
    const marta = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", DEMO_USER_EMAIL))
      .unique();
    if (!marta) {
      throw new Error(
        "No existe el usuario demo todavía - correr seedDemoData primero",
      );
    }
    await ctx.db.patch(marta._id, { rol });
    return { userId: marta._id, rol };
  },
});
