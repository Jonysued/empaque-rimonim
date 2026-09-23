import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";
import { canAccess, roleLabel } from "@/lib/permissions";

export default function RouteGuard({ children }) {
  const location = useLocation();
  const [role, setRole] = useState(undefined);

  useEffect(() => {
    base44.auth.me()
      .then((u) => setRole(u?.role || "user"))
      .catch(() => setRole("user"));
  }, []);

  if (role === undefined) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  if (!canAccess(role, location.pathname)) {
    return (
      <Card className="max-w-md mx-auto mt-10">
        <CardContent className="pt-6 flex flex-col items-center text-center gap-3">
          <ShieldAlert className="w-10 h-10 text-muted-foreground" />
          <p className="font-semibold">Acceso restringido</p>
          <p className="text-sm text-muted-foreground">
            Tu rol ({roleLabel(role)}) no tiene permiso para esta sección.
          </p>
          <Link to="/" className="text-sm text-primary underline">
            Volver al inicio
          </Link>
        </CardContent>
      </Card>
    );
  }

  return children;
}