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

/** A signal from the live stream: the event name and the id of the object it is about (a table id for datahub events). Never data. */
export interface LiveSignal {
  event: string;
  aggregate_id: string | null;
}

/** Screens that need the raw signals (an open table) listen here instead of opening a second stream. */
export const liveBus = new EventTarget();

const DATAHUB_SIGNALS = ["datahub.row.created", "datahub.row.updated", "datahub.row.deleted", "datahub.row.restored", "datahub.formula.recalculated", "datahub.structure.changed", "datahub.share.changed", "datahub.merge.synced", "metrics.data.changed"];

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
    on("datahub.structure.changed", [["datahubs"], ["datahub"], ["dh-table"], ["dh-limits"]]);
    on("datahub.share.changed", [["datahubs"], ["datahub"], ["dh-table"]]);
    on("datahub.merge.synced", [["dh-merge"], ["datahubs"], ["datahub"], ["dh-table"]]);
    for (const name of DATAHUB_SIGNALS) {
      es.addEventListener(name, (ev) => {
        try {
          const d = JSON.parse((ev as MessageEvent<string>).data) as LiveSignal;
          liveBus.dispatchEvent(new CustomEvent<LiveSignal>("signal", { detail: { event: name, aggregate_id: d.aggregate_id } }));
        } catch {
          /* a signal we cannot read is ignored */
        }
      });
    }
    return () => es.close();
  }, [enabled, qc]);
}
