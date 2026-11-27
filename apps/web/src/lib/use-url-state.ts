import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

type Params = Record<string, string>;

/** The router parses "?n=12" into the number 12: bring every value back to text, and a missing one to its default. */
export function readParams<T extends { [K in keyof T]: string }>(search: Record<string, unknown>, defaults: T): T {
  const out: Params = {};
  for (const k of Object.keys(defaults)) {
    const v = search[k];
    out[k] = v === undefined || v === null ? (defaults as Params)[k]! : String(v);
  }
  return out as T;
}

/** The next search object: the patch applied, and every key that is back to its default (or empty) removed so the URL stays short. */
export function mergeSearch(prev: Record<string, unknown>, patch: Params, defaults: Params): Record<string, unknown> {
  const next: Record<string, unknown> = { ...prev };
  for (const [k, v] of Object.entries(patch)) {
    if (v === (defaults[k] ?? "")) delete next[k];
    else next[k] = v;
  }
  return next;
}

/**
 * Keeps a tab or filter in the URL search params so a reload, a shared link and the back button bring it back.
 * `defaults` lists the keys this page owns (a module constant); other params of the URL are left alone.
 * Changes replace the current history entry: typing never fills the back stack.
 * Scroll position on return is restored by the router (see `scrollRestoration` in router.tsx).
 */
export function useUrlState<T extends { [K in keyof T]: string }>(defaults: T): [T, (patch: Partial<T>) => void] {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const navigate = useNavigate();
  const value = readParams(search, defaults);
  const set = useCallback(
    (patch: Partial<T>) => {
      void (navigate as (o: unknown) => Promise<void>)({ search: (prev: Record<string, unknown>) => mergeSearch(prev, patch as Params, defaults as Params), replace: true });
    },
    // defaults is a module constant by contract
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate],
  );
  return [value, set];
}
