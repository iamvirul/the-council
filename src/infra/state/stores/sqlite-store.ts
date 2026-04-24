// SQLite session store — sessions persist across MCP server restarts.
// Stored in ~/.council/council.db (single file, no server needed).
// Sessions older than SESSION_TTL_DAYS are expired on startup.
// Enable with: COUNCIL_PERSIST=sqlite
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import type {
  CouncilSession,
  AgentRole,
  ExecutorResponse,
  AideResponse,
  SessionPhase,
  ChancellorResponse,
  SupervisorVerdict,
} from '../../../domain/models/types.js';
import { CouncilError } from '../../../domain/models/types.js';
import type { SessionStore } from '../session-store.js';
import { logger } from '../../logging/logger.js';

const SESSION_TTL_DAYS = 7;
const DEFAULT_DB_DIR  = join(homedir(), '.council');
const DEFAULT_DB_PATH = join(DEFAULT_DB_DIR, 'council.db');

export class SQLiteStore implements SessionStore {
  private db: Database.Database;
  private expirationTimer?: NodeJS.Timeout;
  private closed = false;

  /**
   * @param dbPath - Filesystem path for the SQLite database. Defaults to
   *   `~/.council/council.db`. Overridable primarily for tests to isolate
   *   writes from the user's real home directory.
   */
  constructor(dbPath: string = DEFAULT_DB_PATH) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');  // safe for concurrent readers
    this.db.pragma('foreign_keys = ON');
    this.bootstrap();
    this.expireOld();
    this.expirationTimer = setInterval(() => this.expireOld(), 24 * 60 * 60 * 1000);
    this.expirationTimer.unref();
    const count = (this.db.prepare('SELECT COUNT(*) as n FROM sessions').get() as { n: number }).n;
    logger.info({ db: dbPath, sessions: count }, 'SQLiteStore initialised');
  }

  private bootstrap(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id         TEXT PRIMARY KEY,
        data       TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at);
    `);
  }

  private expireOld(): void {
    const cutoff = new Date(Date.now() - SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db.prepare('DELETE FROM sessions WHERE created_at < ?').run(cutoff);
    if (result.changes > 0) {
      logger.info({ expired: result.changes }, 'SQLiteStore: expired old sessions');
    }
  }

  private write(session: CouncilSession): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO sessions (id, data, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `).run(session.request_id, JSON.stringify(session), session.created_at, now);
  }

  private read(requestId: string): CouncilSession | undefined {
    const cutoff = new Date(Date.now() - SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const row = this.db.prepare('SELECT data, created_at FROM sessions WHERE id = ? AND created_at >= ?').get(requestId, cutoff) as { data: string; created_at: string } | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.data) as CouncilSession;
    } catch (err) {
      throw new CouncilError(
        `Failed to parse session data for ${requestId}: ${row.data.slice(0, 100)}`,
        'SESSION_PARSE_ERROR',
      );
    }
  }

  create(problem: string): CouncilSession {
    const session: CouncilSession = {
      request_id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      problem,
      phase: 'planning',
      executor_progress: { completed_steps: [], results: [] },
      aide_results: [],
      supervisor_verdicts: [],
      metrics: { total_agent_calls: 0, agents_invoked: [], eval_retries: 0 },
    };
    this.write(session);
    return session;
  }

  get(requestId: string): CouncilSession {
    const session = this.read(requestId);
    if (!session) throw new CouncilError(`Session not found: ${requestId}`, 'SESSION_NOT_FOUND');
    return session;
  }

  getOptional(requestId: string): CouncilSession | undefined {
    return this.read(requestId);
  }

  setPhase(requestId: string, phase: SessionPhase): void {
    const s = this.get(requestId);
    s.phase = phase;
    this.write(s);
  }

  setChancellorPlan(requestId: string, plan: ChancellorResponse): void {
    const s = this.get(requestId);
    s.chancellor_plan = plan;
    this.write(s);
  }

  setCurrentStep(requestId: string, stepId: string): void {
    const s = this.get(requestId);
    s.executor_progress.current_step = stepId;
    this.write(s);
  }

  recordAgentCall(requestId: string, role: AgentRole): void {
    const s = this.get(requestId);
    s.metrics.total_agent_calls++;
    if (!s.metrics.agents_invoked.includes(role)) s.metrics.agents_invoked.push(role);
    this.write(s);
  }

  recordExecutorResult(requestId: string, result: ExecutorResponse): void {
    const s = this.get(requestId);
    s.executor_progress.results.push(result);
    s.executor_progress.completed_steps.push(result.step_id);
    s.executor_progress.current_step = result.next_step;
    this.write(s);
  }

  recordAideResult(requestId: string, result: AideResponse): void {
    const s = this.get(requestId);
    s.aide_results.push(result);
    this.write(s);
  }

  recordSupervisorVerdict(requestId: string, verdict: SupervisorVerdict): void {
    const s = this.get(requestId);
    s.supervisor_verdicts.push(verdict);
    this.write(s);
  }

  recordCavemanMode(requestId: string, mode: string): void {
    const s = this.get(requestId);
    s.metrics.caveman_mode = mode;
    this.write(s);
  }

  recordEvalRetry(requestId: string): void {
    const s = this.get(requestId);
    s.metrics.eval_retries = (s.metrics.eval_retries ?? 0) + 1;
    this.write(s);
  }

  complete(requestId: string, startedAt: number): void {
    const s = this.get(requestId);
    s.phase = 'complete';
    s.metrics.duration_ms = Date.now() - startedAt;
    this.write(s);
  }

  fail(requestId: string, startedAt: number): void {
    const s = this.get(requestId);
    s.phase = 'failed';
    s.metrics.duration_ms = Date.now() - startedAt;
    this.write(s);
  }

  list(): CouncilSession[] {
    const cutoff = new Date(Date.now() - SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const rows = this.db.prepare('SELECT data, id FROM sessions WHERE created_at >= ? ORDER BY created_at DESC').all(cutoff) as { data: string; id: string }[];
    const sessions: CouncilSession[] = [];
    for (const row of rows) {
      try {
        sessions.push(JSON.parse(row.data) as CouncilSession);
      } catch (err) {
        logger.warn({ id: row.id, err }, 'SQLiteStore: skipping row with corrupt JSON');
      }
    }
    return sessions;
  }

  delete(requestId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(requestId);
  }

  close(): void {
    if (this.closed) return;
    if (this.expirationTimer) {
      clearInterval(this.expirationTimer);
      this.expirationTimer = undefined;
    }
    this.db.close();
    this.closed = true;
    logger.info('SQLiteStore closed');
  }
}