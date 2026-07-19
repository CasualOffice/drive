// The Redux store. Currently holds only the RTK Query cache (`baseApi`); as more
// domains migrate off Context/rxjs, their slices are added to `reducer` here.

import { configureStore } from "@reduxjs/toolkit";

import { baseApi } from "./baseApi.ts";

export const store = configureStore({
  reducer: {
    [baseApi.reducerPath]: baseApi.reducer,
  },
  // RTK Query's middleware powers caching, invalidation, polling, and refetch.
  middleware: (getDefault) => getDefault().concat(baseApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
