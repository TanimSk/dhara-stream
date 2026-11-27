import { useQuery } from "@tanstack/react-query";

import { get, qs } from "../lib/api";
import type { Account, AdminClient, Category, Page, Video } from "../lib/types";

export function useAccount() {
  return useQuery({
    queryKey: ["account"],
    queryFn: () =>
      get<{ account: Account; stats: { videos: number; storage_bytes: number; seconds: number; private: number; categories: number }; player_origin: string; api_origin: string }>("/account"),
  });
}

export function useCategories() {
  return useQuery({ queryKey: ["categories"], queryFn: () => get<{ results: Category[] }>("/categories").then((d) => d.results) });
}

export function useVideos(params: { category?: string; visibility?: string; status?: string; q?: string; p?: number }) {
  return useQuery({
    queryKey: ["videos", params],
    queryFn: () => get<Page<Video>>(`/videos${qs(params)}`),
    // Keep refreshing while anything is still uploading elsewhere (e.g. from the desktop app).
    refetchInterval: (q) => (q.state.data?.results.some((v) => v.status === "uploading") ? 8000 : false),
  });
}

export function useVideo(id: string) {
  return useQuery({ queryKey: ["videos", "one", id], queryFn: () => get<{ video: Video }>(`/videos/${id}`).then((d) => d.video) });
}

export function useAdminClients(params: { q?: string; status?: string; p?: number }) {
  return useQuery({ queryKey: ["admin", "clients", params], queryFn: () => get<Page<AdminClient>>(`/admin/clients${qs(params)}`) });
}

export function useAdminClient(id: string) {
  return useQuery({ queryKey: ["admin", "clients", "one", id], queryFn: () => get<{ client: AdminClient }>(`/admin/clients/${id}`).then((d) => d.client) });
}
