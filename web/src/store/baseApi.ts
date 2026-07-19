// RTK Query API layer — the typed, cached server-state client for the SPA.
//
// Rather than reimplement fetch/CSRF/error handling, the baseQuery runs an
// arbitrary `client.ts` call, so RTK Query is purely a caching + hooks +
// devtools layer over the existing typed client. CSRF, `credentials`, demo-mode,
// and `ApiError` stay defined once in `api/client.ts` — one source of truth.
//
// This is the first slice of the incremental Context/rxjs -> Redux migration
// (CAPABILITY-TRACKER §"Frontend state"): the session reads (`me`,
// `setupStatus`) move here; more domains follow slice by slice.

import { createApi, type BaseQueryFn } from "@reduxjs/toolkit/query/react";

import * as api from "../api/client.ts";
import { ApiError } from "../api/client.ts";

/** Error shape surfaced by every endpoint — mirrors [`ApiError`]. */
export interface ApiQueryError {
  /** HTTP status, or `"CLIENT_ERROR"` for a non-HTTP failure (offline, thrown). */
  status: number | "CLIENT_ERROR";
  data: unknown;
  message?: string;
  requestId?: string;
}

/**
 * Run a `client.ts` call and normalize its outcome to RTK Query's
 * `{ data } | { error }`. The endpoint's `query` returns the thunk to run, so
 * each endpoint just names an existing client function.
 */
const clientBaseQuery: BaseQueryFn<() => Promise<unknown>, unknown, ApiQueryError> = async (
  run,
) => {
  try {
    return { data: await run() };
  } catch (err) {
    if (err instanceof ApiError) {
      return {
        error: {
          status: err.status,
          data: err.body,
          message: err.message,
          requestId: err.requestId,
        },
      };
    }
    return { error: { status: "CLIENT_ERROR", data: null, message: String(err) } };
  }
};

export const baseApi = createApi({
  reducerPath: "api",
  baseQuery: clientBaseQuery,
  // `Session` is invalidated on sign-in/out so the cached `me` refetches.
  tagTypes: ["Session"],
  endpoints: (build) => ({
    me: build.query<api.Me, void>({
      query: () => () => api.me(),
      providesTags: ["Session"],
    }),
    setupStatus: build.query<api.SetupStatus, void>({
      query: () => () => api.setupStatus(),
    }),
  }),
});

export const { useMeQuery, useSetupStatusQuery } = baseApi;
