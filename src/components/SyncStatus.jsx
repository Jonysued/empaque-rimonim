import React, { useEffect, useState } from "react";
import { discardOperation, getOperations, retryOperation, syncOperations } from "@/lib/operationQueue";
import { Button } from "@/components/ui/button";

const names = {
  move_pallet_location: "Movimiento de pallet",
  change_cooling_cycle: "Ciclo de prefrío",
  load_pallet_into_shipment: "Carga de pallet",
};

export default function SyncStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const [operations, setOperations] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const items = await getOperations();
        if (mounted) setOperations(items);
      } catch { /* AuthContext handles expired sessions. */ }
    };
    const onChange = () => { setOnline(navigator.onLine); refresh(); };
    const onResume = () => { if (document.visibilityState === "visible") syncOperations().catch(() => {}).finally(refresh); };
    const onOnline = () => { onChange(); onResume(); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onChange);
    window.addEventListener("rimonim-queue-change", onChange);
    document.addEventListener("visibilitychange", onResume);
    const timer = window.setInterval(onResume, 30000);
    onResume();
    return () => {
      mounted = false;
      window.clearInterval(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onChange);
      window.removeEventListener("rimonim-queue-change", onChange);
      document.removeEventListener("visibilitychange", onResume);
    };
  }, []);

  async function retry(id) {
    setBusy(true);
    try { await retryOperation(id); } finally {
      setOperations(await getOperations().catch(() => []));
      setBusy(false);
    }
  }

  async function discard(id) {
    if (!window.confirm("¿Descartar esta operación rechazada? No se registrará en el servidor.")) return;
    setBusy(true);
    try { await discardOperation(id); } finally {
      setOperations(await getOperations().catch(() => []));
      setBusy(false);
    }
  }

  if (online && !operations.length) return null;
  const conflicts = operations.filter(item => item.status === "conflict");
  const pending = operations.length - conflicts.length;
  return (
    <div role="status" className="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="font-medium">
        {!online ? "Sin conexión. " : ""}
        {pending ? `${pending} operación${pending === 1 ? "" : "es"} pendiente${pending === 1 ? "" : "s"} de sincronizar. ` : ""}
        {conflicts.length ? `${conflicts.length} operación${conflicts.length === 1 ? "" : "es"} requiere${conflicts.length === 1 ? "" : "n"} revisión.` : ""}
      </p>
      {operations.length > 0 && <p className="mt-1">Hasta que se sincronice, el cambio no está confirmado en el servidor ni visible en otros dispositivos.</p>}
      {conflicts.map(item => <div key={item.id} className="mt-2 border-t border-amber-300 pt-2">
        <p>{names[item.rpc] || "Operación"}: {item.error || "El servidor rechazó el cambio"}</p>
        {online && <Button size="sm" variant="outline" disabled={busy} className="mt-2" onClick={() => retry(item.id)}>Reintentar</Button>}
        <Button size="sm" variant="ghost" disabled={busy} className="mt-2 ml-2" onClick={() => discard(item.id)}>Descartar</Button>
      </div>)}
    </div>
  );
}
