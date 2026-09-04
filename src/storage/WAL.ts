import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { TriageSOSData } from '../network/serialization/Serializer';

export interface MeshDB extends DBSchema {
  triageLogs: {
    key: string; // The SOS message ID
    value: TriageSOSData;
    indexes: {
      'by-timestamp': number;
      'by-id': string;
    };
  };
}

const DB_NAME = 'mesh-os-db';
const DB_VERSION = 2;
const MAX_LOG_RETENTION = 2000;
const BATCH_FLUSH_DELAY_MS = 30;

// Internal singleton connection promise
let dbPromise: Promise<IDBPDatabase<MeshDB>> | null = null;

// In-memory mirrored ring-buffer for instant O(1) synchronous reads
const inMemoryCache = new Map<string, TriageSOSData>();

// Queue for batched write-ahead transaction flushing
let writeQueue = new Map<string, TriageSOSData>();
let flushTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingFlushPromises: Array<{ resolve: () => void; reject: (err: unknown) => void }> = [];

/**
 * Initializes and upgrades the IndexedDB database for Mesh·OS.
 * Idempotent and thread-safe.
 */
export async function getWALDatabase(): Promise<IDBPDatabase<MeshDB>> {
  if (!dbPromise) {
    dbPromise = openDB<MeshDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        const store = db.objectStoreNames.contains('triageLogs')
          ? transaction.objectStore('triageLogs')
          : db.createObjectStore('triageLogs', { keyPath: 'id' });

        if (!store.indexNames.contains('by-timestamp')) {
          store.createIndex('by-timestamp', 'timestamp');
        }
        if (!store.indexNames.contains('by-id')) {
          store.createIndex('by-id', 'id', { unique: true });
        }

        console.log(`[WAL] IndexedDB upgraded from v${oldVersion} to v${DB_VERSION}`);
      },
      blocked() {
        console.warn('[WAL] IndexedDB upgrade blocked by older open connection.');
      },
      blocking() {
        console.warn('[WAL] Closing older connection to allow upgrade.');
        dbPromise = null;
      },
      terminated() {
        console.error('[WAL] IndexedDB connection abnormally terminated by browser.');
        dbPromise = null;
      },
    });
  }
  return dbPromise;
}

/**
 * Flushes all queued write-ahead logs to IndexedDB in an atomic readwrite transaction.
 */
async function flushWriteQueue(): Promise<void> {
  flushTimeout = null;
  if (writeQueue.size === 0) {
    const promises = pendingFlushPromises;
    pendingFlushPromises = [];
    promises.forEach((p) => p.resolve());
    return;
  }

  const itemsToFlush = Array.from(writeQueue.values());
  writeQueue.clear();

  const currentPromises = pendingFlushPromises;
  pendingFlushPromises = [];

  try {
    const db = await getWALDatabase();
    const tx = db.transaction('triageLogs', 'readwrite');
    const store = tx.objectStore('triageLogs');

    await Promise.all(itemsToFlush.map((item) => store.put(item)));
    await tx.done;

    currentPromises.forEach((p) => p.resolve());
  } catch (err) {
    console.error('[WAL] Atomic batch flush failed:', err);
    currentPromises.forEach((p) => p.reject(err));
  }
}

/**
 * Appends a log entry to the Write-Ahead Log.
 * Immediately updates the in-memory mirror and schedules an atomic batch flush.
 */
export function appendLog(msg: TriageSOSData): Promise<void> {
  const normalized: TriageSOSData = {
    ...msg,
    status: msg.status || 'PENDING',
  };

  // 1. Instantly update in-memory cache for zero-latency UI read access
  inMemoryCache.set(normalized.id, normalized);

  // 2. Queue for batched disk write
  writeQueue.set(normalized.id, normalized);

  return new Promise<void>((resolve, reject) => {
    pendingFlushPromises.push({ resolve, reject });

    if (!flushTimeout) {
      flushTimeout = setTimeout(flushWriteQueue, BATCH_FLUSH_DELAY_MS);
    }
  });
}

/**
 * Batch-appends multiple logs in a single atomic transaction.
 */
export async function batchAppendLogs(msgs: TriageSOSData[]): Promise<void> {
  if (!msgs.length) return;

  msgs.forEach((m) => {
    const norm = { ...m, status: m.status || 'PENDING' };
    inMemoryCache.set(norm.id, norm);
    writeQueue.set(norm.id, norm);
  });

  if (flushTimeout) {
    clearTimeout(flushTimeout);
  }
  return flushWriteQueue();
}

/**
 * Reconstitutes the entire incident state from IndexedDB into memory on boot.
 * Validates integrity and returns sorted incident logs.
 */
export async function reconstituteFromWAL(): Promise<TriageSOSData[]> {
  try {
    const db = await getWALDatabase();
    const tx = db.transaction('triageLogs', 'readonly');
    const index = tx.store.index('by-timestamp');
    const records = await index.getAll();

    inMemoryCache.clear();
    const validRecords: TriageSOSData[] = [];

    for (const record of records) {
      if (record && typeof record.id === 'string' && typeof record.timestamp === 'number') {
        const normalized: TriageSOSData = {
          ...record,
          status: record.status || 'PENDING',
        };
        inMemoryCache.set(normalized.id, normalized);
        validRecords.push(normalized);
      } else {
        console.warn('[WAL] Corrupt log entry discarded during reconstitution:', record);
      }
    }

    // Auto-prune if exceeding maximum retention
    if (validRecords.length > MAX_LOG_RETENTION) {
      pruneOldLogs(MAX_LOG_RETENTION).catch((err) =>
        console.error('[WAL] Background retention pruning error:', err)
      );
    }

    console.log(`[WAL] Reconstituted ${validRecords.length} records from persistent storage.`);
    return validRecords.sort((a, b) => a.timestamp - b.timestamp);
  } catch (err) {
    console.error('[WAL] Crash recovery reconstitution failed:', err);
    return Array.from(inMemoryCache.values()).sort((a, b) => a.timestamp - b.timestamp);
  }
}

/**
 * Prunes older RESOLVED or LOW priority records to enforce bounded storage limits.
 */
export async function pruneOldLogs(maxCount: number = MAX_LOG_RETENTION): Promise<number> {
  try {
    const db = await getWALDatabase();
    const count = await db.count('triageLogs');
    if (count <= maxCount) return 0;

    const excess = count - maxCount;
    const tx = db.transaction('triageLogs', 'readwrite');
    const index = tx.store.index('by-timestamp');
    let cursor = await index.openCursor();
    let deletedCount = 0;

    // Prune oldest resolved incidents first
    while (cursor && deletedCount < excess) {
      const record = cursor.value;
      if (record.status === 'RESOLVED') {
        inMemoryCache.delete(record.id);
        await cursor.delete();
        deletedCount++;
      }
      cursor = await cursor.continue();
    }

    // If still over quota, prune oldest regardless of status (strict ring-buffer)
    if (deletedCount < excess) {
      cursor = await index.openCursor();
      while (cursor && deletedCount < excess) {
        inMemoryCache.delete(cursor.value.id);
        await cursor.delete();
        deletedCount++;
        cursor = await cursor.continue();
      }
    }

    await tx.done;
    console.log(`[WAL] Pruned ${deletedCount} ancient records to respect bounded storage quota.`);
    return deletedCount;
  } catch (err) {
    console.error('[WAL] Log pruning failed:', err);
    return 0;
  }
}

/**
 * Synchronously retrieves a log from the in-memory mirror.
 */
export function getCachedLog(id: string): TriageSOSData | undefined {
  return inMemoryCache.get(id);
}

/**
 * Legacy compatibility aliases for existing store functions.
 */
export async function saveMessageToWAL(msg: TriageSOSData): Promise<void> {
  return appendLog(msg);
}

export async function loadAllMessagesFromWAL(): Promise<TriageSOSData[]> {
  return reconstituteFromWAL();
}

export async function initWAL(): Promise<IDBPDatabase<MeshDB>> {
  return getWALDatabase();
}
