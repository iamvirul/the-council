// File-based JSON session store.
// Each session is stored as ~/.council/sessions/<session_id>.json
// Sessions older than SESSION_TTL_DAYS are expired on startup.
// Enable with: COUNCIL_PERSIST=file
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, renameSync } from 'fs';
import { join } from 'path';
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
const MAX_SESSIONS = 500;
const SESSIONS_DIR = join(homedir(), '.council', 'sessions');

export class FileStore implements SessionStore {
  private cache = new Map<string, CouncilSession>();

  constructor() {
    mkdirSync(SESSIONS_DIR, { recursive: true });
    this.loadAll();
    this.expireOld();
    setInterval(() => this.expireOld(), 6 * 60 * 60 * 1000).unref();
    logger.info({ dir: SESSIONS_DIR, sessions: this.cache.size }, 'FileStore initialised');
  }

  private sessionPath(requestId: string): string {
    return join(SESSIONS_DIR, `${requestId}.json`);
  }

  private persist(session: CouncilSession): void {
    try {
      const sessionPath = this.sessionPath(session.request_id);
      const tmpPath = sessionPath + '.tmp';
      writeFileSync(tmpPath, JSON.stringify(session, null, 2), 'utf8');
      renameSync(tmpPath, sessionPath);
    } catch (err) {
      logger.error({ requestId: session.request_id, err }, 'FileStore: failed to write session');
    }
  }

  private loadAll(): void {
    if (!existsSync(SESSIONS_DIR)) return;
    for (const file of readdirSync(SESSIONS_DIR)) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = readFileSync(join(SESSIONS_DIR, file), 'utf8');
        const session = JSON.parse(raw) as CouncilSession;
        if (session.request_id) {
          this.cache.set(session.request_id, session);
        } else {
          logger.warn({ file }, 'FileStore: skipping session file with missing request_id');
        }
      } catch (err) {
        logger.warn({ file, err }, 'FileStore: skipping corrupt session file');
      }
    }
  }

  private expireOld(): void {
    const cutoff = Date.now() - SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
    let expired = 0;
    for (const session of this.cache.values()) {
      if (new Date(session.created_at).getTime() < cutoff) {
        this.cache.delete(session.request_id);
        try { unlinkSync(this.sessionPath(session.request_id)); } catch { /* already gone */ }
        expired++;
      }
    }
    if (expired > 0) logger.info({ expired }, 'FileStore: expired old sessions');
  }

  create(problem: string): CouncilSession {
    if (this.cache.size >= MAX_SESSIONS) {
      const oldest = [...this.cache.values()].sort(
        (a, b) => a.created_at.localeCompare(b.created_at),
      )[0];
      if (oldest) {
        this.cache.delete(oldest.request_id);
        try { unlinkSync(this.sessionPath(oldest.request_id)); } catch { /* already gone */ }
      }
    }

    const session: CouncilSession = {
      request_id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      problem,
      phase: 'planning',
      executor_progress: { completed_steps: [], results: [] },
      aide_results: [],
      supervisor_verdicts: [],
      metrics: { total_agent_calls: 0, agents_invoked: [] },
    };
    this.cache.set(session.request_id, session);
    this.persist(session);
    return session;
  }

  get(requestId: string): CouncilSession {
    const session = this.cache.get(requestId);
    if (!session) throw new CouncilError(`Session not found: ${requestId}`, 'SESSION_NOT_FOUND');
    return session;
  }

  getOptional(requestId: string): CouncilSession | undefined {
    return this.cache.get(requestId);
  }

  setPhase(requestId: string, phase: SessionPhase): void {
    const s = this.get(requestId);
    s.phase = phase;
    this.persist(s);
  }

  setChancellorPlan(requestId: string, plan: ChancellorResponse): void {
    const s = this.get(requestId);
    s.chancellor_plan = plan;
    this.persist(s);
  }

  setCurrentStep(requestId: string, stepId: string): void {
    const s = this.get(requestId);
    s.executor_progress.current_step = stepId;
    this.persist(s);
  }

  recordAgentCall(requestId: string, role: AgentRole): void {
    const s = this.get(requestId);
    s.metrics.total_agent_calls++;
    if (!s.metrics.agents_invoked.includes(role)) s.metrics.agents_invoked.push(role);
    this.persist(s);
  }

  recordExecutorResult(requestId: string, result: ExecutorResponse): void {
    const s = this.get(requestId);
    s.executor_progress.results.push(result);
    s.executor_progress.completed_steps.push(result.step_id);
    s.executor_progress.current_step = result.next_step;
    this.persist(s);
  }

  recordAideResult(requestId: string, result: AideResponse): void {
    const s = this.get(requestId);
    s.aide_results.push(result);
    this.persist(s);
  }

  recordSupervisorVerdict(requestId: string, verdict: SupervisorVerdict): void {
    const s = this.get(requestId);
    s.supervisor_verdicts.push(verdict);
    this.persist(s);
  }

  complete(requestId: string, startedAt: number): void {
    const s = this.get(requestId);
    s.phase = 'complete';
    s.metrics.duration_ms = Date.now() - startedAt;
    this.persist(s);
  }

  fail(requestId: string, startedAt: number): void {
    const s = this.get(requestId);
    s.phase = 'failed';
    s.metrics.duration_ms = Date.now() - startedAt;
    this.persist(s);
  }

  list(): CouncilSession[] {
    return Array.from(this.cache.values());
  }

  delete(requestId: string): void {
    this.cache.delete(requestId);
    try { unlinkSync(this.sessionPath(requestId)); } catch { /* already gone */ }
  }
}