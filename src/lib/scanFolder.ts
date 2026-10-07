/**
 * ─── Réception d'un scan depuis le scanner branché au poste ───────────────────
 * Un navigateur ne peut pas piloter un scanner (ni TWAIN, ni WIA) : en revanche
 * tout logiciel de scanner (HP, Epson, Canon, « Numériser » de Windows…) range
 * le scan dans un DOSSIER. On choisit ce dossier une fois (API File System
 * Access — Chrome / Edge sur ordinateur), son accès est gardé dans IndexedDB, et
 * à chaque scan on guette le nouveau fichier image pour le prendre tout seul.
 * ──────────────────────────────────────────────────────────────────────────────
 */

const DB = 'scan-folder', STORE = 'handles', KEY = 'invoices';
const IMAGE_EXT = /\.(jpe?g|png|webp|bmp|tiff?|heic|heif)$/i;

export const scanFolderSupported = (): boolean =>
  typeof window !== 'undefined' && 'showDirectoryPicker' in window;

function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE);
      open.onerror = () => resolve(undefined);
      open.onsuccess = () => {
        const tx = open.result.transaction(STORE, mode);
        const req = run(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => resolve(undefined);
      };
    } catch { resolve(undefined); }
  });
}

export const savedScanFolder = () => idb<any>('readonly', s => s.get(KEY));
const saveScanFolder = (h: any) => idb('readwrite', s => s.put(h, KEY));

/** Demande (ou redemande) un dossier au poste. À appeler depuis un clic. */
export async function pickScanFolder(): Promise<any | null> {
  try {
    const h = await (window as any).showDirectoryPicker({ id: 'scan-factures', mode: 'read' });
    await saveScanFolder(h);
    return h;
  } catch { return null; }                     // fenêtre fermée
}

/** Le dossier mémorisé, avec la permission de lecture (re)donnée — sinon null. */
export async function readyScanFolder(): Promise<any | null> {
  const h = await savedScanFolder();
  if (!h) return null;
  try {
    let p = await h.queryPermission({ mode: 'read' });
    if (p !== 'granted') p = await h.requestPermission({ mode: 'read' });
    return p === 'granted' ? h : null;
  } catch { return null; }
}

async function newestImage(dir: any, since: number): Promise<File | null> {
  let best: File | null = null;
  for await (const entry of dir.values()) {
    if (entry.kind !== 'file' || !IMAGE_EXT.test(entry.name)) continue;
    const f: File = await entry.getFile();
    if (f.lastModified >= since && (!best || f.lastModified > best.lastModified)) best = f;
  }
  return best;
}

/**
 * Attend le premier image arrivée dans le dossier après `since`, et la rend une
 * fois son écriture terminée (taille stable sur deux relevés).
 */
export function waitForScan(dir: any, since: number, signal: AbortSignal, timeoutMs = 5 * 60_000): Promise<File | null> {
  return new Promise((resolve) => {
    let last: { name: string; size: number } | null = null;
    const end = Date.now() + timeoutMs;
    const tick = async () => {
      if (signal.aborted || Date.now() > end) return resolve(null);
      try {
        const f = await newestImage(dir, since);
        if (f && f.size > 0) {
          if (last && last.name === f.name && last.size === f.size) return resolve(f);
          last = { name: f.name, size: f.size };
        }
      } catch { /* dossier momentanément illisible : on réessaie */ }
      setTimeout(tick, 1200);
    };
    tick();
  });
}
