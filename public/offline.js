const DB_NAME = 'codesync-offline';
const STORE = 'drafts';
let database;

function openDatabase() {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'workspaceId' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}

async function storeRequest(mode, run) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export const offlineStore = {
  save(draft) { return storeRequest('readwrite', (store) => store.put({ ...draft, savedAt: Date.now() })); },
  get(workspaceId) { return storeRequest('readonly', (store) => store.get(Number(workspaceId))); },
  all() { return storeRequest('readonly', (store) => store.getAll()); },
  remove(workspaceId) { return storeRequest('readwrite', (store) => store.delete(Number(workspaceId))); },
  pending() {
    return storeRequest('readonly', (store) => store.getAll()).then((drafts) => drafts.filter((draft) => draft.pending));
  }
};
