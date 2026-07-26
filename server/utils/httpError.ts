// Helpers for the most common error-response pattern in route
// handlers:
//
//   return res.status(400).json({ error: "..." });
//
// Before consolidation this appeared in ~100 places, each handler
// hand-rolling the `{ error: string }` body and picking a status
// code. The helpers below keep the call site to one line while
// centralising the response shape so cross-cutting concerns
// (e.g. adding a `requestId` or `timestamp` later) only need to
// change here.
//
// All helpers return the response object they were handed (as its own
// type, not a widened one) so callers can write either of:
//
//   return badRequest(res, "filePath is required");
//
//   badRequest(res, "filePath is required");
//   return;
//
// Non-`{ error: string }` shapes (e.g. `{ success: false, message }`
// returned by a handful of legacy routes, or multi-field error
// bodies) stay as explicit `res.status(N).json(...)` calls — the
// helpers intentionally cover only the dominant pattern.

import type { Response } from "express";

/** The body every helper below sends. One declaration so routes can name the
 *  error arm of their response union instead of re-declaring `{ error: string }`
 *  (which had drifted into three separate copies: `ConfigErrorResponse`,
 *  `SessionErrorResponse`, `AccountingErrorResponse`). */
export interface ErrorBody {
  error: string;
}

/** A route response that can carry either its success body or an error.
 *
 *  Prefer this over a bare `Response<T>` anywhere a handler calls one of the
 *  helpers below — which is nearly everywhere. A plain `Response<T>` claims the
 *  route only ever emits `T`, and every one of these helpers makes that false. */
export type ApiResponse<T> = Response<T | ErrorBody>;

/** The exact slice of Express's `Response` these helpers touch: set a status,
 *  then send an `ErrorBody`.
 *
 *  Spelled structurally rather than as `Response` so a caller holding a
 *  generically-parameterised `Response<ResBody>` can pass it without a cast.
 *  A concrete `ResBody` that does not admit `ErrorBody` fails to compile
 *  against this — correctly, because such a response genuinely cannot carry an
 *  error body, and the honest fix is to widen that route's union (i.e. use
 *  `ApiResponse<T>`) rather than to cast the type away. */
export interface ErrorSendable {
  status: (code: number) => { json: (body: ErrorBody) => unknown };
}

/** Send a `{ error: string }` body with the given HTTP status.
 *
 *  Generic over the responder so it serves both plain `Response` call sites
 *  and wrappers (`asyncHandler`) that only know their response structurally.
 *  Returns the same object it was handed, preserving the
 *  `return badRequest(res, …)` idiom below. */
export function sendError<TRes extends ErrorSendable>(res: TRes, status: number, error: string): TRes {
  res.status(status).json({ error });
  return res;
}

/** 400 Bad Request — malformed input, missing required field, etc. */
export function badRequest<TRes extends ErrorSendable>(res: TRes, error: string): TRes {
  return sendError(res, 400, error);
}

/** 401 Unauthorized — missing or invalid credentials. */
export function unauthorized<TRes extends ErrorSendable>(res: TRes, error: string): TRes {
  return sendError(res, 401, error);
}

/** 403 Forbidden — auth present but not authorised for the resource. */
export function forbidden<TRes extends ErrorSendable>(res: TRes, error: string): TRes {
  return sendError(res, 403, error);
}

/** 404 Not Found — resource doesn't exist. */
export function notFound<TRes extends ErrorSendable>(res: TRes, error: string): TRes {
  return sendError(res, 404, error);
}

/** 405 Method Not Allowed — the resource exists but refuses this verb
 *  (e.g. a write against a read-only `dataSource` collection). */
export function methodNotAllowed<TRes extends ErrorSendable>(res: TRes, error: string): TRes {
  return sendError(res, 405, error);
}

/** 409 Conflict — duplicate, concurrent modification, already running, etc. */
export function conflict<TRes extends ErrorSendable>(res: TRes, error: string): TRes {
  return sendError(res, 409, error);
}

/** 500 Internal Server Error — unexpected failure on the server side.
 *
 *  Generic for `asyncHandler`'s benefit: its catch path holds a response typed
 *  only by the structural bound, never a concrete `Response`. */
export function serverError<TRes extends ErrorSendable>(res: TRes, error: string): TRes {
  return sendError(res, 500, error);
}

/** 413 Payload Too Large — request body exceeds an enforced cap. */
export function payloadTooLarge<TRes extends ErrorSendable>(res: TRes, error: string): TRes {
  return sendError(res, 413, error);
}

/** 503 Service Unavailable — a capability/dependency is off or not yet
 *  ready (e.g. an optional binary is missing, a model is still
 *  downloading). Defense-in-depth guard for capability-gated routes. */
export function serviceUnavailable<TRes extends ErrorSendable>(res: TRes, error: string): TRes {
  return sendError(res, 503, error);
}
