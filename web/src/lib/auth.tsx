import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { api, post, refreshAccess, setAccessToken } from "./api";
import { desktop } from "./desktop";
import type { User } from "./types";

interface AuthState {
  ready: boolean;
  user: User | null;
  signIn: (email: string, password: string) => Promise<User>;
  signOut: () => Promise<void>;
  reload: () => Promise<User | null>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const qc = useQueryClient();

  const reload = useCallback(async () => {
    try {
      const data = await api<{ user: User }>("/auth/me");
      setUser(data.user);
      return data.user;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    refreshAccess().then(async (ok) => {
      if (ok) await reload();
      setReady(true);
    });
  }, [reload]);

  const value: AuthState = {
    ready,
    user,
    reload,
    signIn: async (email, password) => {
      const data = await post<{ access: string; refresh?: string; user: User }>("/auth/login", {
        email,
        password,
        device: desktop ? "desktop" : "web",
      });
      setAccessToken(data.access);
      if (desktop && data.refresh) await desktop.setRefresh(data.refresh);
      setUser(data.user);
      return data.user;
    },
    signOut: async () => {
      const refresh = desktop ? await desktop.getRefresh() : undefined;
      await post("/auth/logout", refresh ? { refresh } : {}).catch(() => {});
      if (desktop) await desktop.setRefresh(null);
      setAccessToken(null);
      setUser(null);
      qc.clear();
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
