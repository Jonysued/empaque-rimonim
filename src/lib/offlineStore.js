const DB_NAME = "rimonim-operations";
const DB_VERSION = 1;
let dbPromise;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("commands", { keyPath: "id" });
        db.createObjectStore("snapshots");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Cerrá las otras pestañas de Empaco y volvé a intentar"));
    });
  }
  return dbPromise;
}

async function store(name, mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(name, mode);
    const request = action(transaction.objectStore(name));
    transaction.oncomplete = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export const saveSnapshot = (ownerId, key, value) =>
  store("snapshots", "readwrite", s => s.put(value, `${ownerId}:${key}`));
export const readSnapshot = (ownerId, key) =>
  store("snapshots", "readonly", s => s.get(`${ownerId}:${key}`));
export const saveLastOwner = id => store("snapshots", "readwrite", s => s.put(id, "last-authenticated-user"));
export const readLastOwner = () => store("snapshots", "readonly", s => s.get("last-authenticated-user"));
export const clearLastOwner = () => store("snapshots", "readwrite", s => s.delete("last-authenticated-user"));
export const saveCommand = command => store("commands", "readwrite", s => s.put(command));
export const removeCommand = id => store("commands", "readwrite", s => s.delete(id));
export const listCommands = async ownerId =>
  (await store("commands", "readonly", s => s.getAll()))
    .filter(command => command.ownerId === ownerId)
    .sort((a, b) => a.sequence && b.sequence ? a.sequence - b.sequence : a.createdAt.localeCompare(b.createdAt));

// One read/write transaction across tabs prevents double scans from enqueuing
// two commands for the same pallet. A persisted sequence preserves scan order
// even when several scans share the same millisecond.
export async function enqueueCommand(command) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["commands", "snapshots"], "readwrite");
    const commands = tx.objectStore("commands"), snapshots = tx.objectStore("snapshots");
    let failure;
    const lookup = commands.getAll();
    lookup.onsuccess = () => {
      if (lookup.result.some(item => item.ownerId === command.ownerId && item.resourceKey === command.resourceKey)) {
        failure = new Error("Este registro ya tiene una operación pendiente o en revisión");
        tx.abort();
        return;
      }
      const counter = snapshots.get("command-sequence");
      counter.onsuccess = () => {
        const sequence = Number(counter.result || 0) + 1;
        snapshots.put(sequence, "command-sequence");
        commands.add({ ...command, sequence });
      };
    };
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(failure || tx.error);
  });
}
