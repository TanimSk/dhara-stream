import { Code2, FolderClosed, PlayCircle, Settings } from "lucide-react";
import { Outlet } from "react-router-dom";

import { isDesktop } from "../lib/desktop";
import { UploadProvider } from "../lib/upload/store";
import { Shell, type NavEntry } from "./Shell";
import UploadTray from "./UploadTray";
import { Badge } from "./ui";

const NAV: NavEntry[] = [
  { to: "/app", label: "Videos", icon: PlayCircle, end: true },
  { to: "/app/categories", label: "Categories", icon: FolderClosed },
  { to: "/app/embedding", label: "Embed & security", icon: Code2 },
  { to: "/app/settings", label: "Settings", icon: Settings },
];

export default function AppShell() {
  return (
    <UploadProvider>
      <Shell nav={NAV} home="/app" badge={isDesktop ? <Badge tone="clay">Desktop</Badge> : null}>
        <Outlet />
      </Shell>
      <UploadTray />
    </UploadProvider>
  );
}
