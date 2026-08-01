/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ResendOTP from "../ResendOTP.js";
import type * as auth from "../auth.js";
import type * as authMaintenance from "../authMaintenance.js";
import type * as authz from "../authz.js";
import type * as clientes from "../clientes.js";
import type * as crons from "../crons.js";
import type * as emailUtils from "../emailUtils.js";
import type * as fechas from "../fechas.js";
import type * as http from "../http.js";
import type * as interacciones from "../interacciones.js";
import type * as recuperacion from "../recuperacion.js";
import type * as redirectOrigins from "../redirectOrigins.js";
import type * as seed from "../seed.js";
import type * as seguimientos from "../seguimientos.js";
import type * as usuarios from "../usuarios.js";
import type * as validaciones from "../validaciones.js";
import type * as ventas from "../ventas.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ResendOTP: typeof ResendOTP;
  auth: typeof auth;
  authMaintenance: typeof authMaintenance;
  authz: typeof authz;
  clientes: typeof clientes;
  crons: typeof crons;
  emailUtils: typeof emailUtils;
  fechas: typeof fechas;
  http: typeof http;
  interacciones: typeof interacciones;
  recuperacion: typeof recuperacion;
  redirectOrigins: typeof redirectOrigins;
  seed: typeof seed;
  seguimientos: typeof seguimientos;
  usuarios: typeof usuarios;
  validaciones: typeof validaciones;
  ventas: typeof ventas;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
