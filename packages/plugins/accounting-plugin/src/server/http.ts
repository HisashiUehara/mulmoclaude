// Tiny Express helper owned by the package so the router is
// self-contained (no host util imports). `asyncHandler` turns an
// uncaught throw inside an async handler into a logged 500 carrying
// only the caller-supplied fallback message — never the raw error text
// (which could leak internals).
//
// Deliberately NOT shared with the host's server/utils/asyncHandler.ts:
// a plugin importing host code is an uphill import, forbidden by the
// package-dependency-direction rule. This copy is also scoped to the
// package logger and diverges — it forwards to Express `next(err)` on
// `headersSent` (the host copy doesn't). Do not "de-dupe" it by reaching
// into the host; lift it into @mulmoclaude/core if it ever must be shared.

import type { Request, Response, NextFunction } from "express";
import { log } from "./context.js";
import { errorMessage } from "../shared/errors.js";

/** The body the catch path sends. Declared here rather than imported from the
 *  host's `httpError.ts` for the same reason the wrapper is copied: reaching
 *  into the host would be an uphill import. */
export interface ErrorBody {
  error: string;
}

/** A route response that can carry either its success body or an error — use
 *  this, not a bare `Response<T>`, for any handler wrapped by `asyncHandler`,
 *  which can always emit `ErrorBody` on the failure path. */
export type ApiResponse<T> = Response<T | ErrorBody>;

/** The bounds below name exactly what the catch path dereferences.
 *
 *  They are NOT `extends Request` / `extends Response`: Express uses its type
 *  parameters in mixed variance positions, so a nominal bound rejects valid
 *  call sites like `Request<object, unknown, MyBody>`. Naming only the members
 *  we touch keeps every concrete `Request<…>` / `Response<…>` assignable.
 *
 *  Structural bounds rather than unconstrained generics plus `as` casts,
 *  because the casts were load-bearing in a way that hid a real contract: this
 *  wrapper sends `{ error }` on the failure path, so a route declaring a
 *  `ResBody` that cannot carry it was lying. That is now a compile error, and
 *  the fix at such a site is `ApiResponse<T>`. */
interface RoutePathBearing {
  path: string;
}

interface ErrorSendableResponse {
  headersSent: boolean;
  status: (code: number) => { json: (body: ErrorBody) => unknown };
}

export function asyncHandler<TReq extends RoutePathBearing = Request, TRes extends ErrorSendableResponse = Response>(
  namespace: string,
  fallbackMessage: string,
  handler: (req: TReq, res: TRes) => Promise<void>,
): (req: TReq, res: TRes, next: NextFunction) => Promise<void> {
  return async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (err) {
      log.error(namespace, "handler threw", { route: req.path, error: errorMessage(err) });
      if (res.headersSent) {
        // Response already (partially) sent — we can't write a clean 500.
        // Forward to Express's error flow so it can destroy the socket
        // rather than leaving the request hanging.
        next(err);
        return;
      }
      res.status(500).json({ error: fallbackMessage });
    }
  };
}
