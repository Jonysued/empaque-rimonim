import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ROLES, roleLabel } from "@/lib/permissions";
import { UserPlus, Users } from "lucide-react";

export default function Usuarios() {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("produccion");
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState("");

  const load = () => {
    base44.entities.User.list()
      .then(setUsers)
      .catch(() => setError("No se pudo cargar la lista de usuarios."));
  };

  useEffect(() => {
    load();
  }, []);

  const changeRole = (userId, newRole) => {
    base44.entities.User.update(userId, { role: newRole })
      .then(load)
      .catch(() => setError("No se pudo actualizar el rol."));
  };

  const invite = () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteMsg("");
    base44.users.inviteUser(inviteEmail.trim(), inviteRole)
      .then(() => {
        setInviteMsg(`Invitación enviada a ${inviteEmail.trim()}`);
        setInviteEmail("");
        load();
      })
      .catch(() => setInviteMsg("No se pudo enviar la invitación. Verificá el email."))
      .finally(() => setInviting(false));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="w-6 h-6" /> Usuarios y roles
        </h1>
        <p className="text-sm text-muted-foreground">
          Asigná el puesto de cada usuario para definir sus permisos.
        </p>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="w-4 h-4" /> Invitar usuario
          </CardTitle>
          <CardDescription>
            El invitado recibirá un email para crear su cuenta con el rol elegido.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
          <div className="flex-1 w-full space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="usuario@rimonim.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
          </div>
          <div className="w-full sm:w-56 space-y-1.5">
            <Label>Rol</Label>
            <Select value={inviteRole} onValueChange={setInviteRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={invite} disabled={inviting || !inviteEmail.trim()}>
            {inviting ? "Enviando..." : "Invitar"}
          </Button>
        </CardContent>
        {inviteMsg && (
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground">{inviteMsg}</p>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usuarios</CardTitle>
          <CardDescription>
            Los roles controlan qué secciones y operaciones puede usar cada persona.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {users === null && (
            <div className="flex items-center justify-center py-10">
              <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
            </div>
          )}
          {users !== null && users.length === 0 && (
            <p className="text-sm text-muted-foreground py-4">No hay usuarios registrados.</p>
          )}
          {users !== null && users.map((u) => (
            <div
              key={u.id}
              className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 justify-between border rounded-lg px-4 py-3"
            >
              <div className="min-w-0">
                <p className="font-medium truncate">{u.full_name || u.email}</p>
                <p className="text-xs text-muted-foreground truncate">{u.email}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  {roleLabel(u.role)}
                </span>
                <Select value={u.role || "user"} onValueChange={(v) => changeRole(u.id, v)}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label} — {r.description}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}