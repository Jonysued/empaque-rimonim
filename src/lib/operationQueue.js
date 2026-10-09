import { supabase, localSessionIdentity } from "@/api/base44Client";
import { listCommands, removeCommand, saveCommand, enqueueCommand, readLastOwner, readSnapshot, saveSnapshot } from "@/lib/offlineStore";
import { Capacitor } from "@capacitor/core";
import { workspaceOwner } from "@/lib/workspace";

const notify = () => window.dispatchEvent(new Event("rimonim-queue-change"));
let draining;

async function currentOwner() {
  if (Capacitor.isNativePlatform() && !navigator.onLine) {
    const ownerId = await readLastOwner();
    if (ownerId) return workspaceOwner(ownerId);
  }
  if (Capacitor.isNativePlatform()) return workspaceOwner((await localSessionIdentity()).id);
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.user?.id) throw new Error("Iniciá sesión para registrar operaciones");
  return workspaceOwner(session.user.id);
}

export const getOperations = async () => listCommands(await currentOwner());

export function isConnectionError(error) {
  return error instanceof TypeError || error?.status === 0 || /fetch failed|failed to fetch|networkerror/i.test(error?.message || "");
}

async function drain(ownerId) {
  if (!navigator.onLine) return;
  if (Capacitor.isNativePlatform() && (await localSessionIdentity()).offline) return;
  for (;;) {
    const command = (await listCommands(ownerId))[0];
    if (!command) return;
    if (command.status === "conflict") return;
    // A different account must never replay commands saved on this device.
    if (await currentOwner() !== ownerId) return;
    let error, data;
    try {
      if (command.rpc === "create_receipt_lot") {
        const { p_record: record } = command.params;
        ({ error } = await supabase.from("records").insert({
          entity: "ReceiptLot", id: command.id,
          data: { ...record, id: command.id, operation_id: command.id },
        }));
        if (error?.code === "23505") {
          // The first request may have committed before the connection dropped.
          // Never upsert: a later dump could already have changed this lot.
          const lookup = await supabase.from("records").select("data")
            .eq("entity", "ReceiptLot").eq("id", command.id).single();
          if (lookup.error) error = lookup.error;
          else if (lookup.data?.data?.operation_id === command.id &&
                   lookup.data.data.lot_code === record.lot_code) error = null;
        }
      } else {
        ({ error, data } = await supabase.rpc(command.rpc, command.params));
      }
    } catch (unexpected) {
      if (isConnectionError(unexpected)) return;
      error = unexpected;
    }
    if (error) {
      if (isConnectionError(error)) return;
      await saveCommand({ ...command, status: "conflict", error: error.message });
      notify();
      return; // preserve order: later commands may depend on this one.
    }
    if (command.rpc === 'offline_record_operation' && data?.record) {
      const entity = command.params.p_entity;
      const snapshot = await readSnapshot(ownerId, entity) || [];
      await saveSnapshot(ownerId, entity, [...snapshot.filter(row => row.id !== data.record.id), data.record]);
    }
    if (['load_pallet_into_shipment','unload_pallet_from_shipment'].includes(command.rpc)) {
      // Keep confirmed snapshots aligned even when syncing in the background.
      // If the read loses signal, keep this UUID pending and safely replay it.
      try {
        for (const [entity, id] of [['Shipment', command.params.p_shipment_id], ['Pallet', command.params.p_pallet_id]]) {
          const latest = await supabase.from('records').select('id,data,created_date').eq('entity',entity).eq('id',id).single();
          if (latest.error) throw latest.error;
          const snapshot = await readSnapshot(ownerId, entity) || [];
          await saveSnapshot(ownerId, entity, [...snapshot.filter(row => row.id !== id), latest.data]);
        }
      } catch (error) {
        if (isConnectionError(error)) return;
        await saveCommand({ ...command, status: 'conflict', error: error.message });
        notify(); return;
      }
    }
    await removeCommand(command.id);
    notify();
  }
}

export async function syncOperations() {
  if (draining) return draining;
  draining = (async () => {
    const ownerId = await currentOwner();
    if (navigator.locks) return navigator.locks.request("rimonim-operation-sync", () => drain(ownerId));
    return drain(ownerId);
  })().finally(() => { draining = null; });
  return draining;
}

export async function submitOperation(rpc, params, resourceKey, operationId = crypto.randomUUID()) {
  const ownerId = await currentOwner();
  const id = operationId;
  const command = {
    id, ownerId, rpc, params: { ...params, p_operation_id: id }, resourceKey,
    status: "pending", createdAt: new Date().toISOString(), error: "",
  };
  // Persist first: if the process dies after the server commits, replaying this
  // exact UUID returns the first result instead of repeating the movement.
  await enqueueCommand(command);
  notify();
  if (navigator.onLine) await syncOperations();
  const remaining = (await listCommands(ownerId)).find(item => item.id === id);
  if (remaining?.status === "conflict") throw new Error(remaining.error);
  return { operation_id: id, pending: Boolean(remaining) };
}

export async function retryOperation(id) {
  const ownerId = await currentOwner();
  const command = (await listCommands(ownerId)).find(item => item.id === id);
  if (!command || command.status !== "conflict") return;
  await saveCommand({ ...command, status: "pending", error: "" });
  notify();
  await syncOperations();
}

export async function discardOperation(id) {
  const ownerId = await currentOwner();
  const command = (await listCommands(ownerId)).find(item => item.id === id);
  if (!command || command.status !== "conflict") return;
  await removeCommand(id);
  notify();
  await syncOperations();
}
