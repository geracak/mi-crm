import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import Google from "@auth/core/providers/google";
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { ResendOTP } from "./ResendOTP";
import { normalizarEmail, ventanaCodigoMs } from "./emailUtils";
import { origenesPermitidos, resolverDestino } from "./redirectOrigins";
import { assertLongitudMax, MAX_NOMBRE_PERSONA, MAX_EMAIL } from "./validaciones";

/**
 * GER-240 — Mensaje ÚNICO de rechazo del registro. Se usa igual en el wrapper y
 * en `createOrUpdateUser` a propósito: dos textos distintos volverían a separar
 * "este correo ya existe" de "este correo no existe", que es justo el oráculo de
 * enumeración que este cambio cierra (hallazgo A2).
 */
const REGISTRO_NO_PERMITIDO = "Registro no permitido";

/**
 * GER-219 (E2) — Código de un solo uso vencido. Mensaje propio y distinto del
 * de "código incorrecto": acá sí conviene diferenciarlos, porque no revelan
 * nada (para llegar a este punto hay que tener un código que existió de verdad)
 * y en cambio saber que venció es lo que le dice a la persona que pida otro en
 * vez de volver a teclear el mismo.
 */
const CODIGO_VENCIDO = "El código venció. Pedí uno nuevo.";

/**
 * GER-242 — Quien entra con Google ya tiene acceso: apagar la marca de
 * "invitación sin activar".
 *
 * ⚠️ Por qué hace falta: alguien invitada cuyo correo coincide con su cuenta de
 * Google puede entrar por ahí sin pasar nunca por el código. Entraba bien, pero
 * `passwordPendiente` quedaba encendido PARA SIEMPRE, y a partir de ahí
 * `estadoCuenta` la seguía tratando como invitación sin activar: el login le
 * ofrecía "Te dieron acceso al CRM, escribí el código" a alguien que hacía rato
 * que entraba sin problemas.
 *
 * Se llama SOLO desde autenticaciones de Google que ya pasaron todas las
 * comprobaciones de acceso — nunca antes de validarlas. Y solo escribe si la
 * marca está encendida, así que un login normal no genera escritura.
 *
 * La marca significa "la contraseña la puso el sistema, no la persona", y sigue
 * siendo cierto: no tiene una propia. Pero lo que gobierna es "¿hay que mandarla
 * a activar?", y la respuesta pasa a ser no. Si después quiere contraseña, la
 * consigue por "¿Olvidaste tu contraseña?" con la ventana normal de 15 minutos.
 */
async function apagarPendienteSiGoogle(
  ctx: MutationCtx,
  providerId: string,
  usuario: Doc<"users">,
): Promise<void> {
  if (providerId !== "google") return;
  if (usuario.passwordPendiente !== true) return;
  await ctx.db.patch(usuario._id, { passwordPendiente: false });
}

const passwordBase = Password<DataModel>({
  // GER-239: proveedor del código de un solo uso para el flujo `reset`.
  // Habilita signIn("password", { flow: "reset" | "reset-verification" }).
  reset: ResendOTP,
  // Perfil PÚBLICO: solo email/name, NUNCA rol. El único profile con rol lo
  // produce el seed (createAccount).
  //
  // GER-239: `profile` corre en los flujos que quedan vivos (signIn, reset,
  // reset-verification), así que normalizar aquí es lo que hace que
  // `retrieveAccount` encuentre la cuenta sin importar cómo se teclee el
  // correo. NO basta por sí solo: la verificación posterior compara los
  // params ORIGINALES, y de eso se ocupan el wrapper de abajo y el `authorize`
  // de ResendOTP.
  profile(params) {
    return {
      email: normalizarEmail(params.email as string),
      name: (params.name as string | undefined) || undefined,
    };
  },
});

/**
 * GER-240 — Punto de control ÚNICO de todo lo que entra por `auth:signIn`.
 *
 * ⚠️ Por qué existe: `auth:signIn` es una acción PÚBLICA (lo tiene que ser) y
 * su rama `flow: "signUp"` verificaba la contraseña de una cuenta existente SIN
 * consultar `authRateLimits` — ver
 * `dist/server/implementation/mutations/createAccountFromCredentials.js:23-40`,
 * donde `Provider.verify` se llama a pelo. La rama `flow: "signIn"` sí aplica el
 * límite de 10 fallos/hora (`.../retrieveAccountWithCredentials.js:26-33`).
 * Resultado medido contra el deployment de desarrollo antes de este cambio:
 * 20 intentos seguidos sin bloqueo, `authRateLimits` sin tocar (attemptsLeft
 * 9 → 9) y la contraseña correcta devolviendo tokens con sesión nueva.
 *
 * ⚠️ Por qué el wrapper va dentro de `options` y NO en el nivel superior:
 * `ConvexCredentials(config)` devuelve
 * `{ id, type, authorize: async () => null, options: config }`
 * (`dist/providers/ConvexCredentials.js:28-35`) y al materializar,
 * `providerDefaults` hace `merge(provider, provider.options)`
 * (`dist/server/provider_utils.js:144-161`). Como `merge` no considera objeto a
 * una función, `options.authorize` PISA al de arriba con `Object.assign`.
 * Sobrescribir el de arriba no haría absolutamente nada.
 *
 * ⚠️ `options` es un interno de la librería (lo marca `@ts-expect-error
 * Internal`), así que este acoplamiento se protege con la aserción de abajo:
 * si una futura versión cambia la forma, el módulo LANZA al cargarse y el
 * deploy falla ruidoso. Nunca en silencio, que es como se pierden los controles.
 *
 * GER-219 — el wrapper suma una tercera responsabilidad: apagar
 * `users.passwordPendiente` cuando alguien completa un `reset-verification`.
 * Va acá porque este es el único punto que ve TODOS los flujos de contraseña,
 * y porque hacerlo en el servidor evita depender del handshake de sesión del
 * navegador (el detalle, en el paso 3 del `authorize` de abajo).
 */

/**
 * Lo que devuelve el `authorize` del provider Password. Verificado en
 * `@convex-dev/auth@0.0.94` (`src/providers/ConvexCredentials.ts:52-65`):
 * `{ userId, sessionId? } | null`.
 */
type ResultadoAuthorize = {
  userId: Id<"users">;
  sessionId?: Id<"authSessions">;
} | null;

/**
 * El `ctx` de `authorize` es `GenericActionCtxWithAuthConfig<DataModel>` (misma
 * referencia), o sea un ActionCtx: tiene `runMutation` y `runQuery`. Se declara
 * solo lo que se usa, para no atarse a más superficie de la librería que la
 * necesaria.
 */
type CtxAuthorize = {
  runMutation: ActionCtx["runMutation"];
  runQuery: ActionCtx["runQuery"];
};

type AuthorizeCredenciales = (
  params: Record<string, unknown>,
  ctx: CtxAuthorize,
) => Promise<ResultadoAuthorize>;

/**
 * Estrecha en RUNTIME el resultado antes de leer `userId`. No alcanza con el
 * tipo: `authorizeOriginal` sale de un `options` interno casteado, así que el
 * compilador no garantiza nada sobre lo que devuelve de verdad.
 */
function tieneUserId(
  resultado: ResultadoAuthorize,
): resultado is { userId: Id<"users">; sessionId?: Id<"authSessions"> } {
  return (
    resultado !== null &&
    typeof resultado === "object" &&
    typeof (resultado as { userId?: unknown }).userId === "string"
  );
}

const opcionesPassword = (
  passwordBase as unknown as { options?: { authorize?: unknown } }
).options;

if (typeof opcionesPassword?.authorize !== "function") {
  throw new Error(
    "@convex-dev/auth cambió de forma: `options.authorize` ya no existe en el provider Password. " +
      "El wrapper de seguridad de convex/auth.ts (GER-240) depende de él — revisarlo antes de desplegar.",
  );
}

const authorizeOriginal = opcionesPassword.authorize as AuthorizeCredenciales;

const PasswordEndurecido = {
  ...passwordBase,
  options: {
    ...opcionesPassword,
    authorize: async (params: Record<string, unknown>, ctx: CtxAuthorize) => {
      // 1) Registro cerrado, aplicado ANTES de mirar ninguna credencial. Cortar
      //    aquí es lo que elimina el acceso al `Provider.verify` sin límite.
      //    El mismo error para todos los casos: sin oráculo de enumeración.
      if (params.flow === "signUp") {
        throw new ConvexError(REGISTRO_NO_PERMITIDO);
      }

      // 2) Normalizar el correo en una COPIA. La librería propaga estos mismos
      //    `params` hasta `verifyCodeAndSignInImpl`, que usa `params.email` en
      //    crudo como clave del límite de intentos del código
      //    (`dist/server/implementation/mutations/verifyCodeAndSignIn.js:22`).
      //    Sin esto, variar mayúsculas o espacios abre un cubo nuevo en
      //    `authRateLimits` y el límite del OTP deja de servir de nada.
      const email = params.email;
      const paramsNormalizados =
        typeof email === "string"
          ? { ...params, email: normalizarEmail(email) }
          : params;

      // 2.bis) GER-242 — Vencimiento REAL del código, DERIVADO.
      //
      // La librería solo admite un vencimiento por proveedor y acá hacen falta
      // dos (invitación 24 h, recuperación 15 min), así que `maxAge` quedó en el
      // mayor de los dos como tope exterior.
      //
      // ⚠️ El que corresponde a cada código NO se guarda en ningún lado. Antes
      // se guardaba en `users.codigoVenceEn` y esa era la falla: un espejo
      // escrito en otra transacción, cuya AUSENCIA se interpretaba como "sin
      // restricción". Cualquier fallo entre crear el código y escribir el
      // espejo dejaba un código de recuperación heredando las 24 h del tope
      // exterior — 96 veces su ventana. Fail-open, que es la peor forma de
      // fallar en un control de seguridad.
      //
      // Ahora se calcula acá mismo, a partir de dos cosas que no pueden
      // desincronizarse porque ninguna se escribe para esto: cuándo nació la
      // fila del código y si la cuenta está en activación.
      //
      // ⚠️ Va ANTES de `authorizeOriginal`: ese es el que llama a
      // `modifyAccountCredentials` y cambia la contraseña de verdad
      // (`dist/providers/Password.js:118-122`). Comprobarlo después dejaría la
      // contraseña ya cambiada por un código vencido.
      if (params.flow === "reset-verification" && typeof email === "string") {
        const estado = await ctx.runQuery(internal.usuarios._estadoCodigo, {
          email: normalizarEmail(email),
        });

        // Ambigüedad de datos (varias cuentas con el mismo identificador, o
        // varios códigos para una cuenta): no se elige ninguno al azar y no se
        // deja cambiar la contraseña. Mismo criterio que el resto de las
        // guardas del proyecto.
        if (estado.tipo === "ambiguo") {
          throw new ConvexError(CODIGO_VENCIDO);
        }

        // `sin-codigo` no se rechaza acá: sin fila no hay nada que verificar y
        // `authorizeOriginal` va a fallar igual. Es fail-closed por
        // construcción, no por convención.
        if (
          estado.tipo === "ok" &&
          Date.now() - estado.creadoEn > ventanaCodigoMs(estado.pendiente)
        ) {
          throw new ConvexError(CODIGO_VENCIDO);
        }
      }

      const resultado = await authorizeOriginal(paramsNormalizados, ctx);

      // 3) GER-219 — apagar `passwordPendiente` cuando la persona ACABA de
      //    elegir su contraseña. Este es el momento autoritativo: el
      //    `reset-verification` de la librería ya corrió
      //    `modifyAccountCredentials` con el secreto que tecleó ella
      //    (`src/providers/Password.ts:178-205`), todo dentro de esta misma
      //    llamada.
      //
      //    ⚠️ Por qué acá y no en el cliente: entre que `signIn()` devuelve y
      //    el navegador confirma la sesión hay una demora (el handshake lo
      //    arranca `ConvexProviderWithAuth` después, desde un efecto). Una
      //    mutación lanzada desde el cliente justo después del `signIn` puede
      //    salir sin sesión todavía, y `requireUsuario` la rechazaría: o el
      //    flag se queda encendido para siempre, o el error se confunde con
      //    "código incorrecto" sobre un reset que sí funcionó.
      //
      //    Solo corre en `reset-verification`. `signIn` y `reset` no tocan la
      //    contraseña, así que no tienen nada que apagar.
      if (params.flow === "reset-verification" && tieneUserId(resultado)) {
        try {
          await ctx.runMutation(internal.usuarios._marcarPasswordConfigurada, {
            id: resultado.userId,
          });
        } catch (error) {
          // Nunca hacer fallar el login por esto: la contraseña nueva YA quedó
          // guardada, así que lanzar acá mostraría "código incorrecto o
          // vencido" sobre un reset exitoso. El flag se apaga solo en el
          // próximo reset, por este mismo camino.
          //
          // ⚠️ Se registra el mensaje del error y nada más. NUNCA `params`:
          // ahí viajan `newPassword` y `code` en claro.
          console.error(
            "GER-219: no se pudo apagar passwordPendiente tras el reset:",
            error instanceof Error ? error.message : String(error),
          );
        }
      }

      return resultado;
    },
  },
  // El objeto lleva `options`, que no está en el tipo público del provider. El
  // cast es deliberado y la aserción de arriba es lo que sustituye a la
  // comprobación de tipos.
} as unknown as typeof passwordBase;

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    PasswordEndurecido,
    Google({
      // Mapeo explícito: nos interesa `email_verified` para decidir el linking
      // en createOrUpdateUser (nunca vincular con un email que Google no verificó).
      profile(googleProfile) {
        return {
          id: googleProfile.sub,
          email: googleProfile.email,
          name: googleProfile.name,
          image: googleProfile.picture,
          emailVerified: googleProfile.email_verified,
        };
      },
    }),
  ],
  callbacks: {
    // GER-238: sustituye al validador por defecto para que el login pueda
    // completarse desde cualquiera de los orígenes dados de alta, no solo desde
    // `SITE_URL`. Corre en el callback de OAuth, con el `redirectTo` que quedó
    // guardado en cookie al arrancar el flujo
    // (`dist/server/implementation/index.js:168-190`). La lógica vive en
    // `redirectOrigins.ts` para poder ejercitarla aislada.
    async redirect({ redirectTo }) {
      const siteUrl = process.env.SITE_URL;
      if (siteUrl === undefined || siteUrl === "") {
        throw new Error("Falta la variable de entorno SITE_URL");
      }
      try {
        return resolverDestino(
          redirectTo,
          siteUrl,
          origenesPermitidos(siteUrl, process.env.AUTH_ADDITIONAL_ORIGINS),
        );
      } catch (error) {
        // El motivo queda en los logs del deployment; hacia afuera, un error
        // neutro. La librería atrapa esto y redirige sin parámetro de error.
        console.error("GER-238 redirect rechazado:", (error as Error).message);
        throw new ConvexError("Destino de redirección no permitido");
      }
    },

    // Regla de aprovisionamiento (no "rechazar toda creación", que bloquearía el
    // propio seed): se crea un usuario nuevo SOLO si el profile trae un rol
    // válido, y ese rol solo lo produce el seed interno vía createAccount.
    // Google NUNCA crea usuarios: solo puede VINCULARSE a uno ya provisionado
    // (registro cerrado por diseño — GER-238).
    async createOrUpdateUser(ctxLoose, args) {
      // `ctxLoose.db` viene tipado contra `AnyDataModel` (firma genérica de la
      // librería) y no conoce nuestro índice `email`; casteamos al `MutationCtx`
      // generado para este proyecto, que sí lo tiene.
      const ctx = ctxLoose as unknown as MutationCtx;

      // Revalida el rol SIEMPRE, incluso en la ruta ya vinculada: una cuenta
      // desprovisionada (rol removido después de vincularse) no debe poder
      // re-autenticar solo porque su authAccount ya existía de antes.
      if (args.existingUserId !== null) {
        const usuario = await ctx.db.get(args.existingUserId);
        if (
          usuario === null ||
          (usuario.rol !== "propietaria" && usuario.rol !== "comercial")
        ) {
          throw new ConvexError(
            "Esta cuenta ya no tiene acceso. Contactá a la persona dueña del CRM.",
          );
        }
        await apagarPendienteSiGoogle(ctx, args.provider.id, usuario);
        return args.existingUserId;
      }

      const profile = args.profile as Record<string, unknown> & {
        email?: string;
        emailVerified?: boolean;
        passwordPendiente?: boolean;
      };

      if (args.provider.id === "google") {
        const email =
          typeof profile.email === "string" ? profile.email : undefined;
        // Google no verificó el email → nunca vincular (evita takeover de cuenta).
        if (!email || profile.emailVerified !== true) {
          throw new ConvexError(
            "Esta cuenta de Google no tiene acceso. Contactá a la persona dueña del CRM.",
          );
        }
        // Mismo patrón que `uniqueUserWithVerifiedEmail` de la librería
        // (@convex-dev/auth/dist/server/implementation/users.js): 0 o >1
        // coincidencias se tratan igual (rechazo neutro), nunca se elige al azar.
        const candidatos = await ctx.db
          .query("users")
          .withIndex("email", (q) => q.eq("email", email))
          .take(2);
        const existente = candidatos.length === 1 ? candidatos[0] : null;
        if (
          existente === null ||
          (existente.rol !== "propietaria" && existente.rol !== "comercial")
        ) {
          throw new ConvexError(
            "Esta cuenta de Google no tiene acceso. Contactá a la persona dueña del CRM.",
          );
        }
        await apagarPendienteSiGoogle(ctx, args.provider.id, existente);
        return existente._id; // vincula, no crea
      }

      // Defensa en profundidad: el wrapper ya corta `flow: "signUp"` antes de
      // llegar aquí (GER-240). Esto sigue cubriendo cualquier otro camino que
      // intente crear un usuario sin rol válido.
      const rol = profile.rol;
      if (rol !== "propietaria" && rol !== "comercial") {
        throw new ConvexError(REGISTRO_NO_PERMITIDO);
      }
      // GER-251 — Defensa final de longitud, mismo idioma que el control de rol
      // de arriba: `usuarios.invitar` ya valida antes de llegar acá, pero esta
      // rama también la alcanza `seed.ts` directamente, sin pasar por `invitar`.
      const nombreProfile =
        typeof profile.name === "string" ? profile.name : undefined;
      const emailProfile =
        typeof profile.email === "string" ? profile.email : undefined;
      if (nombreProfile !== undefined) {
        assertLongitudMax(nombreProfile, MAX_NOMBRE_PERSONA, "El nombre");
      }
      if (emailProfile !== undefined) {
        assertLongitudMax(emailProfile, MAX_EMAIL, "El correo");
      }
      return await ctx.db.insert("users", {
        email: emailProfile,
        name: nombreProfile,
        rol,
        // GER-219 — UN campo más, nombrado explícitamente. Sigue sin haber
        // spread del `profile`: esta lista blanca es el control que endureció
        // GER-240 y se mantiene igual de estricta. Es seguro sumarlo acá porque
        // esta rama solo la alcanza `createAccount` llamado desde nuestro
        // propio código (`seed.ts`, `usuarios:invitar`) — el wrapper de arriba
        // corta `flow: "signUp"` antes de llegar — y porque el campo NO da
        // acceso a nada: solo decide a qué pantalla manda el login.
        //
        // Va en el MISMO insert a propósito: marcarlo en una segunda escritura
        // dejaría la invitación a medias si esa escritura fallara, y esa cuenta
        // ya no se podría arreglar desde /equipo (el alta chocaría con el
        // control de duplicados y la persona nunca podría entrar).
        //
        // Cualquier valor que no sea exactamente `true` cae en `undefined`, que
        // se lee como "ya tiene contraseña" — el default seguro, y lo que deja
        // al seed funcionando sin cambios.
        passwordPendiente: profile.passwordPendiente === true ? true : undefined,
      });
    },
  },
});
