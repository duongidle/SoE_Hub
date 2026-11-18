import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { ApiError, api } from "./api";

export interface UserView {
  id: string;
  kind: string;
  email: string | null;
  full_name: string;
  title: string | null;
  phone: string | null;
  roles: string[];
  guest_preset: "sale" | "data" | null;
  status: "inactive" | "active" | "locked";
  manager_id: string | null;
  leader_id: string | null;
  last_login_at: string | null;
  version: number;
}

export interface Me {
  user: UserView;
  permissions: string[];
  must_set_password: boolean;
  via: string;
}

/** The signed-in person, or null. */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api<Me>("GET", "/auth/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function can(me: Me | null | undefined, permission: string): boolean {
  return !!me?.permissions.includes(permission);
}

/** Listens to the SSE stream and refreshes the matching queries (signals only, never data). */
export function useLiveUpdates(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource("/api/v1/events");
    const on = (name: string, keys: string[][]) =>
      es.addEventListener(name, () => {
        for (const k of keys) void qc.invalidateQueries({ queryKey: k });
      });
    on("notification.notification.created", [["notifications"], ["unread"]]);
    on("org.member.changed", [["org"], ["me"]]);
    on("auth.token.requested", [["admin-tokens"], ["tokens"]]);
    on("auth.token.decided", [["admin-tokens"], ["tokens"]]);
    on("guest.grant.changed", [["grants"]]);
    on("system.setting.changed", [["settings"]]);
    return () => es.close();
  }, [enabled, qc]);
}
