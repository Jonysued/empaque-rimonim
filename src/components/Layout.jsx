import React, { useState, useEffect } from "react";
import empacoLogo from "@/empaco-logo.svg";
import { Link, useLocation, Outlet } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import SyncStatus from "@/components/SyncStatus";
import { cn } from "@/lib/utils";
import { canAccess, roleLabel } from "@/lib/permissions";
import { canManageWorkspaces } from "@/lib/workspace";
import {
  LayoutDashboard, Repeat, Factory, Snowflake,
  Warehouse, Truck, Search, Settings, Menu, X, Users, Scale, Layers, Sprout, Building2
} from "lucide-react";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/recepcion", label: "Cosecha", icon: Sprout },
  { to: "/consolidado-lote", label: "Consolidado de Lote", icon: Layers },
  { to: "/pesado-lote", label: "Pesado de Lote", icon: Scale },
  { to: "/recepcion-playa", label: "Recepción Playa Empaque", icon: Warehouse },
  { to: "/vuelco", label: "Vuelco", icon: Repeat },
  { to: "/produccion", label: "Producción", icon: Factory },
  { to: "/prefrio", label: "Prefrío", icon: Snowflake },
  { to: "/camaras", label: "Cámaras", icon: Warehouse },
  { to: "/despachos", label: "Despachos", icon: Truck },
  { to: "/trazabilidad", label: "Trazabilidad", icon: Search },
  { to: "/catalogos", label: "Catálogos", icon: Settings },
  { to: "/usuarios", label: "Usuarios", icon: Users },
  { to: "/empresas", label: "Espacio de trabajo", icon: Building2 },
];

export default function Layout() {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState(null);
  const visibleNav = NAV.filter(item => canAccess(user?.role || "user", item.to) && (item.to !== '/empresas' || canManageWorkspaces(user)));

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Sidebar desktop */}
      <aside className="app-desktop-sidebar hidden lg:flex fixed inset-y-0 left-0 w-60 flex-col bg-sidebar border-r border-sidebar-border">
        <div className="h-16 flex items-center px-6 border-b border-sidebar-border">
          <div className="flex w-36 flex-col items-center gap-1">
            <img src={empacoLogo} alt="Empaco" className="w-full h-auto rounded" />
            <p className="w-full text-center text-[11px] text-muted-foreground">Tecnología y trazabilidad</p>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          <p className="px-3 py-2 text-sm font-semibold break-words">{user?.workspace?.name || 'Seleccioná una empresa'}</p>
          {visibleNav.map(item => {
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
      <header className="app-mobile-header lg:hidden sticky top-0 z-30 h-14 bg-background border-b flex items-center justify-between px-4">
        <div className="flex min-w-0 items-center">
          <img src={empacoLogo} alt="Empaco" className="w-44 max-w-full h-auto rounded" />
        </div>
        <button aria-label="Abrir menú" onClick={() => setSidebarOpen(true)} className="p-3 -mr-2 shrink-0">
          <Menu className="w-5 h-5" />
        </button>
      </header>

      {/* Drawer mobile */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <aside className="app-mobile-drawer absolute inset-y-0 left-0 w-72 max-w-[80%] bg-background shadow-xl flex flex-col">
            <div className="h-14 shrink-0 flex items-center justify-between px-4 border-b">
              <span className="font-bold">Menú</span>
              <button aria-label="Cerrar menú" onClick={() => setSidebarOpen(false)} className="p-3 -mr-2 shrink-0"><X className="w-5 h-5" /></button>
            </div>
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              <p className="px-3 py-2 text-sm font-semibold break-words">{user?.workspace?.name || 'Seleccioná una empresa'}</p>
              {visibleNav.map(item => {
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
      <main className="min-w-0 lg:pl-60">
        <div className="app-content min-w-0 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          <SyncStatus />
          {user && !user.workspace && (location.pathname !== '/empresas' || !canManageWorkspaces(user)) ? <p>No tenés una empresa asignada. Contactá al administrador.{canManageWorkspaces(user) && <> También podés entrar en <Link className="underline" to="/empresas">Espacio de trabajo</Link>.</>}</p> : <Outlet />}
        </div>
      </main>
    </div>
  );
}
