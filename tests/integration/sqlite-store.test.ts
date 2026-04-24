import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { SQLiteStore } from '../../src/infra/state/stores/sqlite-store.js';

function validSessionRow(id: string, createdAt: string): { data: string; created_at: string } {
  const session = {
    request_id: id,
    created_at: createdAt,
    problem: 'x',
    phase: 'complete',
    executor_progress: { completed_steps: [], results: [] },
    aide_results: [],
    supervisor_verdicts: [],
    metrics: { total_agent_calls: 0, agents_invoked: [], eval_retries: 0 },
  };
  return { data: JSON.stringify(session), created_at: createdAt };
}

describe('SQLiteStore — persistence', () => {
  let dir: string;
  let dbPath: string;
  let store: SQLiteStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'council-sqlite-'));
    dbPath = join(dir, 'test.db');
    store = new SQLiteStore(dbPath);
  });

  afterEach(() => {
    store.close?.();
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips session state via a second SQLiteStore instance on the same DB', () => {
    const s = store.create('problem');
    store.recordAgentCall(s.request_id, 'executor');
    store.recordEvalRetry(s.request_id);
    store.complete(s.request_id, Date.now() - 25);
    store.close();

    const reopened = new SQLiteStore(dbPath);
    try {
      const loaded = reopened.get(s.request_id);
      expect(loaded.problem).toBe('problem');
      expect(loaded.phase).toBe('complete');
      expect(loaded.metrics.agents_invoked).toContain('executor');
      expect(loaded.metrics.eval_retries).toBe(1);
    } finally {
      reopened.close();
    }
  });

  it('list() excludes sessions older than the 7-day TTL', () => {
    store.close();
    // Seed the DB directly with one stale and one fresh session.
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `);
    const stale = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const fresh = new Date().toISOString();
    const insert = db.prepare(
      'INSERT INTO sessions (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)',
    );
    const s1 = validSessionRow('stale', stale);
    const s2 = validSessionRow('fresh', fresh);
    insert.run('stale', s1.data, s1.created_at, s1.created_at);
    insert.run('fresh', s2.data, s2.created_at, s2.created_at);
    db.close();

    const reopened = new SQLiteStore(dbPath);
    try {
      const ids = reopened.list().map(s => s.request_id);
      expect(ids).toContain('fresh');
      expect(ids).not.toContain('stale');
    } finally {
      reopened.close();
    }
  });

  it('deletes stale sessions on construction', () => {
    store.close();
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `);
    const stale = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const row = validSessionRow('stale', stale);
    db.prepare(
      'INSERT INTO sessions (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run('stale', row.data, row.created_at, row.created_at);
    db.close();

    const reopened = new SQLiteStore(dbPath);
    try {
      // The TTL sweep in the constructor should have removed the stale row.
      const check = new Database(dbPath);
      const count = (check.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;
      check.close();
      expect(count).toBe(0);
    } finally {
      reopened.close();
    }
  });

  it('throws SESSION_PARSE_ERROR when a row contains corrupt JSON', () => {
    store.close();

    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `);
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO sessions (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run('corrupt', 'not json', now, now);
    db.close();

    const reopened = new SQLiteStore(dbPath);
    try {
      expect(() => reopened.get('corrupt')).toThrow(/Failed to parse session data/);
    } finally {
      reopened.close();
    }
  });

  it('delete() removes a session from the DB', () => {
    const s = store.create('p');
    expect(store.getOptional(s.request_id)).toBeDefined();
    store.delete(s.request_id);
    expect(store.getOptional(s.request_id)).toBeUndefined();
  });
});
