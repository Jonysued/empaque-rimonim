import React, { useState, useEffect } from "react";
import rimonimLogo from "@/rimonim-logo.svg";
import { Link, useLocation, Outlet } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import SyncStatus from "@/components/SyncStatus";
import { cn } from "@/lib/utils";
import { canAccess, roleLabel } from "@/lib/permissions";
import {
  LayoutDashboard, PackageOpen, Repeat, Factory, Snowflake,
  Warehouse, Truck, Search, Settings, Menu, X, Users
} from "lucide-react";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/recepcion", label: "Recepción", icon: PackageOpen },
  { to: "/vuelco", label: "Vuelco", icon: Repeat },
  { to: "/produccion", label: "Producción", icon: Factory },
  { to: "/prefrio", label: "Prefrío", icon: Snowflake },
  { to: "/camaras", label: "Cámaras", icon: Warehouse },
  { to: "/despachos", label: "Despachos", icon: Truck },
  { to: "/trazabilidad", label: "Trazabilidad", icon: Search },
  { to: "/catalogos", label: "Catálogos", icon: Settings },
  { to: "/usuarios", label: "Usuarios", icon: Users },
];

export default function Layout() {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Sidebar desktop */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-60 flex-col bg-sidebar border-r border-sidebar-border">
        <div className="h-16 flex items-center px-6 border-b border-sidebar-border">
          <div className="flex flex-col gap-1">
            <img src={rimonimLogo} alt="Rimonim" className="w-36 h-auto rounded" />
            <p className="text-[11px] text-muted-foreground">Operación de empaque</p>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV.filter(item => canAccess(user?.role || "user", item.to)).map(item => {
            const active = location.pathname === item.to;
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  active ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border">
          <p className="text-xs text-muted-foreground truncate">
            {user?.email || "Sin sesión"}
          </p>
          <p className="text-[11px] text-muted-foreground">Rol: {roleLabel(user?.role)}</p>
        </div>
      </aside>

      {/* Topbar mobile */}
      <header className="lg:hidden sticky top-0 z-30 h-14 bg-background border-b flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <img src={rimonimLogo} alt="Rimonim" className="w-32 h-auto rounded" />
        </div>
        <button onClick={() => setSidebarOpen(true)} className="p-2 -mr-2">
          <Menu className="w-5 h-5" />
        </button>
      </header>

      {/* Drawer mobile */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[80%] bg-background shadow-xl flex flex-col">
            <div className="h-14 flex items-center justify-between px-4 border-b">
              <span className="font-bold">Menú</span>
              <button onClick={() => setSidebarOpen(false)} className="p-2 -mr-2"><X className="w-5 h-5" /></button>
            </div>
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {NAV.filter(item => canAccess(user?.role || "user", item.to)).map(item => {
                const active = location.pathname === item.to;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      "flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium",
                      active ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                    )}
                  >
                    <Icon className="w-5 h-5 shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Content */}
      <main className="lg:pl-60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <SyncStatus />
          <Outlet />
        </div>
      </main>
    </div>
  );
}
