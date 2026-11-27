import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { LoadingBlock } from "./components/ui";
import { useAuth } from "./lib/auth";
import { isDesktop } from "./lib/desktop";
import type { Role } from "./lib/types";
import Login from "./pages/Login";

const Landing = lazy(() => import("./pages/Landing"));
const AppShell = lazy(() => import("./components/AppShell"));
const Videos = lazy(() => import("./pages/app/Videos"));
const VideoDetail = lazy(() => import("./pages/app/VideoDetail"));
const Categories = lazy(() => import("./pages/app/Categories"));
const Embedding = lazy(() => import("./pages/app/Embedding"));
const Settings = lazy(() => import("./pages/Settings"));
const AdminShell = lazy(() => import("./components/AdminShell"));
const AdminOverview = lazy(() => import("./pages/admin/Overview"));
const AdminClients = lazy(() => import("./pages/admin/Clients"));
const AdminClientDetail = lazy(() => import("./pages/admin/ClientDetail"));

export function homeFor(role: Role) {
  return role === "master" ? "/admin" : "/app";
}

function Require({ role, children }: { role: Role; children: ReactNode }) {
  const { ready, user } = useAuth();
  const location = useLocation();
  if (!ready) return <LoadingBlock />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (user.role !== role) return <Navigate to={homeFor(user.role)} replace />;
  return <>{children}</>;
}

function Home() {
  const { ready, user } = useAuth();
  if (!isDesktop) return <Landing />;
  if (!ready) return <LoadingBlock />;
  return <Navigate to={user ? homeFor(user.role) : "/login"} replace />;
}

export default function App() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/app" element={<Require role="client"><AppShell /></Require>}>
          <Route index element={<Videos />} />
          <Route path="videos/:id" element={<VideoDetail />} />
          <Route path="categories" element={<Categories />} />
          <Route path="embedding" element={<Embedding />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="/admin" element={<Require role="master"><AdminShell /></Require>}>
          <Route index element={<AdminOverview />} />
          <Route path="clients" element={<AdminClients />} />
          <Route path="clients/:id" element={<AdminClientDetail />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
