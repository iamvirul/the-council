// Session store factory — selects backend based on COUNCIL_PERSIST env var.
//
//   COUNCIL_PERSIST=memory  (default) — in-process LRU Map, cleared on restart
//   COUNCIL_PERSIST=file             — JSON files at ~/.council/sessions/
//   COUNCIL_PERSIST=sqlite           — SQLite at ~/.council/council.db
//
// The exported `stateStore` is a drop-in replacement for the old singleton.
// All call sites are unchanged.
import { createRequire } from 'module';
import type { SessionStore } from './session-store.js';
import { MemoryStore } from './stores/memory-store.js';
import { logger } from '../logging/logger.js';

export type { SessionStore };

// createRequire lets us synchronously load CJS-compatible modules inside ESM.
const require = createRequire(import.meta.url);

/**
 * Selects and constructs the process-wide session store implementation based on the COUNCIL_PERSIST environment variable.
 *
 * If COUNCIL_PERSIST is 'file' or 'sqlite' the corresponding persistent store is returned; otherwise the in-memory store is returned (default: 'memory').
 *
 * @returns A `SessionStore` instance configured for the selected persistence mode ('memory', 'file', or 'sqlite').
 */
function createStore(): SessionStore {
  const mode = (process.env['COUNCIL_PERSIST'] ?? 'memory').toLowerCase();

  if (mode === 'file') {
    const { FileStore } = require('./stores/file-store.js') as typeof import('./stores/file-store.js');
    logger.info({ mode: 'file' }, 'Session persistence: file (~/.council/sessions/)');
    return new FileStore();
  }

  if (mode === 'sqlite') {
    const { SQLiteStore } = require('./stores/sqlite-store.js') as typeof import('./stores/sqlite-store.js');
    logger.info({ mode: 'sqlite' }, 'Session persistence: SQLite (~/.council/council.db)');
    return new SQLiteStore();
  }

  if (mode !== 'memory') {
    logger.warn({ COUNCIL_PERSIST: mode }, 'Unknown COUNCIL_PERSIST value — falling back to memory');
  } else {
    logger.info({ mode: 'memory' }, 'Session persistence: memory (cleared on restart)');
  }

  return new MemoryStore();
}

// Singleton — one store per process.
export const stateStore: SessionStore = createStore();
