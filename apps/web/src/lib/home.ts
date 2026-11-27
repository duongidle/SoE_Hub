import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, apiList } from "@/lib/api";

/** Calls of the home page (stage 12D-1): pinned dashboard tabs and "Mở gần đây" live on the server, per person (`home.*`). */

export type RecentType = "datahub" | "form" | "dashboard" | "article";
export interface RecentItem {
  type: RecentType;
  id: string;
  name: string;
  at: string;
  meta: Record<string, string | null>;
}
export interface PinnedTab {
  id: string;
  name: string;
  datahub_id: string;
  datahub_name: string;
  role: "owner" | "shared" | "guest";
}
export interface MyDashboard {
  id: string;
  name: string;
  datahub_id: string;
  datahub_name: string;
  updated_at: string;
}

export const homeKeys = {
  tabs: ["home", "tabs"] as const,
  mine: ["home", "dashboards-mine"] as const,
  recent: ["home", "recent"] as const,
};

export const listTabs = async () => (await apiList<PinnedTab>("/me/home/tabs")).data;
export const listMyDashboards = async () => (await apiList<MyDashboard>("/dashboards/mine")).data;
export const listRecent = async () => (await apiList<RecentItem>("/me/recent")).data;
export const saveTabs = (ids: string[]) => api("PUT", "/me/prefs/home.dashboard_tabs", { value: ids });
export const touchRecent = (type: RecentType, id: string) => api<{ recorded: boolean }>("POST", "/me/recent", { type, id }, { keepalive: true });

/** Link of a recent item (only to places the person may open: the server already filtered the list). */
export function recentLink(e: RecentItem): { to: string; params?: Record<string, string> } {
  switch (e.type) {
    case "datahub":
      return e.meta.system_key === "deal" ? { to: "/quan-ly-deal" } : { to: "/datahub/$datahubId", params: { datahubId: e.id } };
    case "form":
      return { to: "/form/$id", params: { id: e.id } };
    case "dashboard":
      return e.meta.role === "owner" && e.meta.datahub_id ? { to: "/datahub/$datahubId/dashboard/$dashboardId", params: { datahubId: e.meta.datahub_id, dashboardId: e.id } } : { to: "/dashboard/$dashboardId", params: { dashboardId: e.id } };
    case "article":
      return { to: "/knowledge/$id", params: { id: e.id } };
  }
}

/**
 * Tells the server this item was just opened (once when the page shows it). Best effort: a failure changes nothing on the screen,
 * the list on the home page simply misses this entry. Pass `null` while the id is not known or the item should not be tracked.
 */
export function useTouchRecent(type: RecentType, id: string | null | undefined) {
  const qc = useQueryClient();
  const m = useMutation({ mutationFn: () => touchRecent(type, id!), onSuccess: (r) => { if (r.recorded) void qc.invalidateQueries({ queryKey: homeKeys.recent }); } });
  const { mutate } = m;
  useEffect(() => {
    if (id) mutate();
  }, [type, id, mutate]);
}

export const useRecent = () => useQuery({ queryKey: homeKeys.recent, queryFn: listRecent });
