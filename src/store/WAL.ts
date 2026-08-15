import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { TriageSOSData } from '../network/serialization/Serializer';

interface MeshDB extends DBSchema {
  triageLogs: {
    key: string; // The SOS message ID
    value: TriageSOSData;
    indexes: { 'by-timestamp': number };
  };
}

let dbPromise: Promise<IDBPDatabase<MeshDB>> | null = null;

export function initWAL(): Promise<IDBPDatabase<MeshDB>> {
  if (!dbPromise) {
    dbPromise = openDB<MeshDB>('mesh-os-db', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('triageLogs')) {
          const store = db.createObjectStore('triageLogs', { keyPath: 'id' });
          store.createIndex('by-timestamp', 'timestamp');
        }
      },
    });
  }
  return dbPromise;
}

export async function saveMessageToWAL(msg: TriageSOSData): Promise<void> {
  const db = await initWAL();
  await db.put('triageLogs', msg);
}

export async function loadAllMessagesFromWAL(): Promise<TriageSOSData[]> {
  const db = await initWAL();
  const tx = db.transaction('triageLogs', 'readonly');
  const index = tx.store.index('by-timestamp');
  return index.getAll();
}
