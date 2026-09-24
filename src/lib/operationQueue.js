import { supabase } from "@/api/base44Client";
import { listCommands, removeCommand, saveCommand } from "@/lib/offlineStore";

const notify = () => window.dispatchEvent(new Event("rimonim-queue-change"));
let draining;

async function currentOwner() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.user?.id) throw new Error("Iniciá sesión para registrar operaciones");
  return session.user.id;
}

export const getOperations = async () => listCommands(await currentOwner());

export function isConnectionError(error) {
  return error instanceof TypeError || error?.status === 0 || /fetch failed|failed to fetch|networkerror/i.test(error?.message || "");
}

async function drain(ownerId) {
  if (!navigator.onLine) return;
  for (;;) {
    const command = (await listCommands(ownerId))[0];
    if (!command) return;
    if (command.status === "conflict") return;
    // A different account must never replay commands saved on this device.
    if (await currentOwner() !== ownerId) return;
    let error;
    try {
      ({ error } = await supabase.rpc(command.rpc, command.params));
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
    await removeCommand(command.id);
    notify();
  }
}

export async function syncOperations() {
  if (draining) return draining;
  const ownerId = await currentOwner();
  draining = drain(ownerId).finally(() => { draining = null; });
  return draining;
}

export async function submitOperation(rpc, params, resourceKey, operationId = crypto.randomUUID()) {
  const ownerId = await currentOwner();
  const operations = await listCommands(ownerId);
  if (operations.some(item => item.resourceKey === resourceKey)) {
    throw new Error("Hay un movimiento pendiente o en revisión para este pallet o túnel");
  }
  const id = operationId;
  const command = {
    id, ownerId, rpc, params: { ...params, p_operation_id: id }, resourceKey,
    status: "pending", createdAt: new Date().toISOString(), error: "",
  };
  // Persist first: if the process dies after the server commits, replaying this
  // exact UUID returns the first result instead of repeating the movement.
  await saveCommand(command);
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
