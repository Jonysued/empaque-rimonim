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
      request.onblocked = () => reject(new Error("Cerrá las otras pestañas de Rimonim y volvé a intentar"));
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
export const saveCommand = command => store("commands", "readwrite", s => s.put(command));
export const removeCommand = id => store("commands", "readwrite", s => s.delete(id));
export const listCommands = async ownerId =>
  (await store("commands", "readonly", s => s.getAll()))
    .filter(command => command.ownerId === ownerId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
