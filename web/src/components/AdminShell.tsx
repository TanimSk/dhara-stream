import { Building2, LayoutGrid, Settings } from "lucide-react";

import { Shell, type NavEntry } from "./Shell";
import { Badge } from "./ui";

const NAV: NavEntry[] = [
  { to: "/admin", label: "Overview", icon: LayoutGrid, end: true },
  { to: "/admin/clients", label: "Clients", icon: Building2 },
  { to: "/admin/settings", label: "Settings", icon: Settings },
];

export default function AdminShell() {
  return <Shell nav={NAV} home="/admin" badge={<Badge tone="neutral">Admin</Badge>} />;
}
