import { describe, test, expect, afterEach } from 'bun:test';
import { SqliteAdapter } from './sqlite';
import { Database } from 'bun:sqlite';
import { unlinkSync } from 'fs';
import { join } from 'path';

let currentDbPath = '';

function createTestDb(): SqliteAdapter {
  currentDbPath = join(
    import.meta.dir,
    `.test-sqlite-adapter-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  return new SqliteAdapter(currentDbPath);
}

/** Insert a parent codebase row to satisfy FK constraints */
async function insertCodebase(db: SqliteAdapter, id: string): Promise<void> {
  await db.query(`INSERT INTO remote_agent_codebases (id, name, default_cwd) VALUES ($1, $2, $3)`, [
    id,
    `test-codebase-${id}`,
    '/tmp/test-cwd',
  ]);
}

describe('SqliteAdapter', () => {
  let db: SqliteAdapter;

  afterEach(async () => {
    if (db) {
      await db.close();
    }
    try {
      unlinkSync(currentDbPath);
    } catch {
      /* may not exist */
    }
    try {
      unlinkSync(currentDbPath + '-wal');
    } catch {
      /* may not exist */
    }
    try {
      unlinkSync(currentDbPath + '-shm');
    } catch {
      /* may not exist */
    }
  });

  describe('INSERT with RETURNING', () => {
    test('returns inserted row via native RETURNING', async () => {
      db = createTestDb();
      await insertCodebase(db, 'cb-1');

      const result = await db.query<{ id: string; status: string }>(
        `INSERT INTO remote_agent_isolation_environments
         (id, codebase_id, workflow_type, workflow_id, provider, working_path, branch_name, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        ['test-id', 'cb-1', 'issue', '1', 'worktree', '/tmp/test', 'issue-1', 'active']
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].id).toBe('test-id');
      expect(result.rows[0].status).toBe('active');
    });

    test('returns correct row on ON CONFLICT DO UPDATE', async () => {
      db = createTestDb();
      await insertCodebase(db, 'cb-1');

      // Insert initial row
      await db.query(
        `INSERT INTO remote_agent_isolation_environments
         (id, codebase_id, workflow_type, workflow_id, provider, working_path, branch_name, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        ['orig-id', 'cb-1', 'issue', '42', 'worktree', '/tmp/original', 'issue-42', 'active']
      );

      // Upsert with ON CONFLICT -- this is the scenario that was broken
      const result = await db.query<{ id: string; working_path: string; branch_name: string }>(
        `INSERT INTO remote_agent_isolation_environments
         (codebase_id, workflow_type, workflow_id, provider, working_path, branch_name)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (codebase_id, workflow_type, workflow_id) WHERE status = 'active'
         DO UPDATE SET
           working_path = EXCLUDED.working_path,
           branch_name = EXCLUDED.branch_name,
           status = 'active'
         RETURNING *`,
        ['cb-1', 'issue', '42', 'worktree', '/tmp/updated', 'issue-42-v2']
      );

      expect(result.rows).toHaveLength(1);
      // Must return the updated row, not a random/wrong row
      expect(result.rows[0].id).toBe('orig-id');
      expect(result.rows[0].working_path).toBe('/tmp/updated');
      expect(result.rows[0].branch_name).toBe('issue-42-v2');
    });
  });

  describe('placeholder conversion (#999 regression)', () => {
    test('$N inside SQL comments is treated as a placeholder — avoid $N in comments', async () => {
      db = createTestDb();
      await insertCodebase(db, 'cb-1');

      // A query with $1 and $2 as real params, but $3 only appears in a comment.
      // convertPlaceholders replaces ALL $N occurrences including inside comments,
      // producing 3 ? marks for only 2 params → SQLite error.
      const sql = `SELECT * FROM remote_agent_codebases WHERE id = $1 AND name = $2 -- $3 is not a real param`;
      await expect(db.query(sql, ['cb-1', 'test-codebase-cb-1'])).rejects.toThrow();
    });

    test('query succeeds when $N placeholders match param count', async () => {
      db = createTestDb();
      await insertCodebase(db, 'cb-1');

      const result = await db.query<{ id: string }>(
        `SELECT id FROM remote_agent_codebases WHERE id = $1 AND name = $2`,
        ['cb-1', 'test-codebase-cb-1']
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].id).toBe('cb-1');
    });
  });

  describe('UPDATE/DELETE with RETURNING', () => {
    test('throws error for UPDATE RETURNING', async () => {
      db = createTestDb();

      await expect(
        db.query(
          `UPDATE remote_agent_isolation_environments SET status = $1 WHERE id = $2 RETURNING *`,
          ['destroyed', 'test-id']
        )
      ).rejects.toThrow('does not support RETURNING clause on UPDATE/DELETE');
    });
  });

  describe('datetime() chronological vs lexical comparison', () => {
    // Documents the SQLite-specific bug fixed in getActiveWorkflowRunByPath.
    // `started_at` is TEXT in "YYYY-MM-DD HH:MM:SS" format. Comparing it
    // directly to an ISO param "YYYY-MM-DDTHH:MM:SS.mmmZ" with `<` is
    // LEXICAL: char 11 is space (0x20) in the column vs T (0x54) in the
    // param, so every column value lex-sorts before every ISO param,
    // making the comparison ALWAYS true regardless of actual time.
    //
    // Wrapping both sides in datetime() forces chronological comparison.

    test('lexical comparison gives wrong answer for SQLite stored format vs ISO param', async () => {
      db = createTestDb();
      // Column-format value (afternoon) is chronologically AFTER the ISO
      // param (morning), but lex compares char-11 (space < T) → wrong.
      const result = await db.query<{ broken: number }>(
        `SELECT ('2026-04-14 12:00:00' < $1) AS broken`,
        ['2026-04-14T10:00:00.000Z']
      );
      // Expected by chronology: FALSE. Lex says: TRUE.
      expect(result.rows[0].broken).toBe(1);
    });

    test('datetime() wrap on both sides gives chronological comparison', async () => {
      db = createTestDb();
      const result = await db.query<{ correct: number }>(
        `SELECT (datetime('2026-04-14 12:00:00') < datetime($1)) AS correct`,
        ['2026-04-14T10:00:00.000Z']
      );
      // 12:00 < 10:00 is FALSE — datetime() comparison agrees with reality.
      expect(result.rows[0].correct).toBe(0);
    });

    test('datetime() handles equality across formats', async () => {
      db = createTestDb();
      const result = await db.query<{ equal: number }>(
        `SELECT (datetime('2026-04-14 10:00:00') = datetime($1)) AS equal`,
        ['2026-04-14T10:00:00.000Z']
      );
      expect(result.rows[0].equal).toBe(1);
    });
  });

  describe('upgrade from pre-0.4.0 schema (regression for the v0.4.0 init bug)', () => {
    /**
     * v0.4.0 added user_id columns to conversations/workflow_runs/messages and
     * created_by_user_id on isolation_environments via migrateColumns(). It also
     * added CREATE INDEX statements referencing those columns directly inside
     * createSchema(). On an existing pre-0.4.0 database, createSchema()'s
     * CREATE INDEX hit a "no such column: user_id" because migrateColumns()
     * runs AFTER createSchema(), aborting the entire init and leaving every
     * subsequent query broken. This test reproduces that exact pre-0.4.0 shape
     * and asserts that SqliteAdapter construction now completes cleanly and
     * adds both the columns and the indexes.
     */
    test('migrates user_id columns and indexes onto an existing pre-0.4.0 database', () => {
      const dbPath = join(
        import.meta.dir,
        `.test-sqlite-pre040-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
      );
      currentDbPath = dbPath;

      // Seed the file with a minimal pre-0.4.0 shape: the four tables that
      // gained user_id-flavored columns in 0.4.0, with everything EXCEPT
      // those new columns. CREATE TABLE IF NOT EXISTS in createSchema() will
      // then be a no-op for these tables, so the migration path is the one
      // under test.
      const raw = new Database(dbPath);
      raw.exec(`
        CREATE TABLE remote_agent_codebases (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          name TEXT NOT NULL,
          default_cwd TEXT NOT NULL,
          repository_url TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE remote_agent_conversations (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          platform_type TEXT NOT NULL,
          platform_conversation_id TEXT NOT NULL,
          ai_assistant_type TEXT,
          codebase_id TEXT,
          cwd TEXT,
          isolation_env_id TEXT,
          hidden INTEGER DEFAULT 0,
          deleted_at TEXT,
          last_activity_at TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE remote_agent_workflow_runs (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          workflow_name TEXT NOT NULL,
          conversation_id TEXT,
          codebase_id TEXT,
          status TEXT DEFAULT 'pending',
          user_message TEXT,
          metadata TEXT DEFAULT '{}',
          parent_conversation_id TEXT,
          last_activity_at TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE remote_agent_messages (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          conversation_id TEXT,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          metadata TEXT DEFAULT '{}',
          created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE remote_agent_isolation_environments (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          codebase_id TEXT NOT NULL,
          workflow_type TEXT NOT NULL,
          workflow_id TEXT NOT NULL,
          provider TEXT NOT NULL DEFAULT 'worktree',
          working_path TEXT NOT NULL,
          branch_name TEXT NOT NULL,
          created_by_platform TEXT,
          metadata TEXT DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
      `);
      raw.close();

      // Construction must not throw. Before the fix, this errored with
      // "no such column: user_id" on the CREATE INDEX inside createSchema().
      db = new SqliteAdapter(dbPath);

      // The migration should have added every user_id column.
      const codebaseCols = raw_pragma(dbPath, 'remote_agent_codebases');
      expect(codebaseCols).toContain('default_branch');
      // …and the folder-project `kind` discriminator (runtime ALTER on old DBs).
      expect(codebaseCols).toContain('kind');
      // A row inserted without `kind` backfills to 'repo' via the column DEFAULT.
      const writable = new Database(dbPath);
      try {
        writable.run(
          "INSERT INTO remote_agent_codebases (id, name, default_cwd) VALUES ('cb-old', 'legacy', '/tmp/legacy')"
        );
      } finally {
        writable.close();
      }
      const kindRow = raw_query(
        dbPath,
        "SELECT kind FROM remote_agent_codebases WHERE id = 'cb-old'"
      );
      expect(kindRow).toEqual([{ kind: 'repo' }]);

      const conversationCols = raw_pragma(dbPath, 'remote_agent_conversations');
      expect(conversationCols).toContain('user_id');

      const workflowRunCols = raw_pragma(dbPath, 'remote_agent_workflow_runs');
      expect(workflowRunCols).toContain('user_id');

      const messageCols = raw_pragma(dbPath, 'remote_agent_messages');
      expect(messageCols).toContain('user_id');

      const isolationCols = raw_pragma(dbPath, 'remote_agent_isolation_environments');
      expect(isolationCols).toContain('created_by_user_id');

      // And the indexes that previously failed must now exist.
      const indexes = raw_indexes(dbPath);
      expect(indexes).toContain('idx_conversations_user_id');
      expect(indexes).toContain('idx_workflow_runs_user_id');

      // Sanity: querying the table that previously errored at init now works.
      const probe = raw_query(
        dbPath,
        'SELECT COUNT(*) AS n FROM remote_agent_conversations WHERE user_id IS NOT NULL'
      );
      expect(probe).toEqual([{ n: 0 }]);
    });
  });

  describe('provider-key vendor-id migration (#1955)', () => {
    test('renames legacy rows and lets an existing vendor row win on conflict', async () => {
      db = createTestDb();
      const dbPath = currentDbPath;
      // Seed users + legacy/vendor credential rows post-construction…
      await db.query(`INSERT INTO remote_agent_users (id) VALUES ('u1'), ('u2')`, []);
      await db.query(
        `INSERT INTO remote_agent_user_provider_keys (id, user_id, provider, kind, api_key_encrypted, label)
         VALUES
           ('k1', 'u1', 'claude',  'api_key', 'enc-legacy-claude', 'legacy'),
           ('k2', 'u1', 'anthropic', 'api_key', 'enc-vendor-anthropic', 'vendor'),
           ('k3', 'u2', 'codex',   'api_key', 'enc-legacy-codex', NULL),
           ('k4', 'u2', 'copilot', 'oauth',   NULL, 'subscription')`,
        []
      );
      await db.close();

      // …then reopen: migrateColumns() runs the idempotent vendor-id data fix.
      db = new SqliteAdapter(dbPath);
      const rows = raw_query(
        dbPath,
        'SELECT user_id, provider, label FROM remote_agent_user_provider_keys ORDER BY user_id, provider'
      ) as { user_id: string; provider: string; label: string | null }[];
      expect(rows).toEqual([
        // u1: legacy 'claude' row dropped — the explicit 'anthropic' row wins.
        { user_id: 'u1', provider: 'anthropic', label: 'vendor' },
        // u2: no conflicts — legacy ids renamed in place.
        { user_id: 'u2', provider: 'github-copilot', label: 'subscription' },
        { user_id: 'u2', provider: 'openai', label: null },
      ]);

      // Idempotent: a third open changes nothing.
      await db.close();
      db = new SqliteAdapter(dbPath);
      const again = raw_query(
        dbPath,
        'SELECT COUNT(*) AS n FROM remote_agent_user_provider_keys'
      ) as { n: number }[];
      expect(again).toEqual([{ n: 3 }]);
    });
  });

  describe('workflow node checkpoint schema convergence', () => {
    test('creates remote_agent_workflow_node_checkpoints with retry checkpoint columns', () => {
      db = createTestDb();
      const cols = raw_pragma(currentDbPath, 'remote_agent_workflow_node_checkpoints');
      expect(cols).toEqual([
        'workflow_run_id',
        'node_id',
        'retry_epoch',
        'checkpoint_ref',
        'commit_sha',
        'created_commit',
        'fallback_from_node_id',
        'created_at',
      ]);
    });

    test('creates indexes for run/node checkpoint lookup and cleanup by run', () => {
      db = createTestDb();
      const indexes = raw_indexes(currentDbPath);
      expect(indexes).toContain('idx_workflow_node_checkpoints_run');
      expect(indexes).toContain('idx_workflow_node_checkpoints_run_node_epoch');
    });

    test('migrates existing SQLite databases idempotently when checkpoint storage is added', async () => {
      db = createTestDb();
      await db.close();
      db = new SqliteAdapter(currentDbPath);
      const cols = raw_pragma(currentDbPath, 'remote_agent_workflow_node_checkpoints');
      expect(cols).toContain('checkpoint_ref');
    });
  });
});

// ---------------------------------------------------------------------------
// RED-PHASE SCAFFOLD (EXECUTABLE) — Story 3.1 "Implement Archon Workflow
// Provider Binding Lifecycle"
// (_bmad-output/implementation-artifacts/3-1-implement-archon-workflow-provider-binding-lifecycle.md).
//
// Unlike the other new scaffolds for this story, these tests are NOT
// `test.skip()`: the boundary they exercise (a real SqliteAdapter over a
// real bun:sqlite temp file, using raw SQL — the exact same pattern as every
// other `describe` block above) already exists today. They import nothing
// from the not-yet-written `packages/core/src/db/provider-bindings.ts`, so
// there is no missing-module crash risk. They assert the DESIRED end state
// from the Dev Notes "DB Design Proposal" table
// (`remote_agent_workflow_provider_bindings`) and currently fail with
// "no such table: remote_agent_workflow_provider_bindings" because Task 1
// has not yet added the table to `createSchema()` — that IS the red phase.
// They flip green once Task 1 adds the `CREATE TABLE IF NOT EXISTS
// remote_agent_workflow_provider_bindings (...)` block (mirroring the
// `remote_agent_isolation_environments` pattern already in this file, per
// Dev Notes "DB Design Proposal" / "SQLite has no RETURNING on UPDATE/DELETE").
// ---------------------------------------------------------------------------
describe('remote_agent_workflow_provider_bindings (Story 3.1)', () => {
  let db: SqliteAdapter;

  afterEach(async () => {
    if (db) {
      await db.close();
    }
    try {
      unlinkSync(currentDbPath);
    } catch {
      /* may not exist */
    }
    try {
      unlinkSync(currentDbPath + '-wal');
    } catch {
      /* may not exist */
    }
    try {
      unlinkSync(currentDbPath + '-shm');
    } catch {
      /* may not exist */
    }
  });

  async function insertBinding(
    id: string,
    overrides: Partial<{
      provider: string;
      name: string;
      codebaseId: string;
      eventRoute: string;
      signingSecret: string | null;
      state: string;
    }> = {}
  ): Promise<void> {
    const v = {
      provider: 'archon',
      name: 'workflow-engine-primary',
      codebaseId: 'cb-1',
      eventRoute: 'https://hermes.example/events/workflow-engine',
      signingSecret: null,
      state: 'active',
      ...overrides,
    };
    await db.query(
      `INSERT INTO remote_agent_workflow_provider_bindings
       (id, provider, name, codebase_id, event_route, signing_secret, state)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, v.provider, v.name, v.codebaseId, v.eventRoute, v.signingSecret, v.state]
    );
  }

  // 3.1-INT-001 [P0] — Fresh SQLite schema has FK, defaults, and unique
  // identity. Risk: R-003, R-007.
  test('fresh schema: insert applies defaults (state=active, binding_version=1) and both timestamps', async () => {
    db = createTestDb();
    await insertCodebase(db, 'cb-1');
    await insertBinding('wpb-1');

    const result = await db.query<{
      state: string;
      binding_version: number;
      created_at: string | null;
      updated_at: string | null;
    }>(
      `SELECT state, binding_version, created_at, updated_at
       FROM remote_agent_workflow_provider_bindings WHERE id = $1`,
      ['wpb-1']
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.state).toBe('active');
    expect(result.rows[0]?.binding_version).toBe(1);
    expect(result.rows[0]?.created_at).toBeTruthy();
    expect(result.rows[0]?.updated_at).toBeTruthy();
  });

  test('fresh schema: UNIQUE(provider, name) rejects a second row for the same pair', async () => {
    db = createTestDb();
    await insertCodebase(db, 'cb-1');
    await insertBinding('wpb-1');

    await expect(insertBinding('wpb-2')).rejects.toThrow();
  });

  test('fresh schema: codebase_id is a foreign key that rejects an unregistered codebase', async () => {
    db = createTestDb();
    // No insertCodebase() call — 'cb-missing' is never registered. Match on
    // "FOREIGN KEY" specifically (not just "any throw") so this stays a
    // meaningful assertion once the table exists, rather than a vacuous pass
    // driven by "no such table".
    await expect(insertBinding('wpb-1', { codebaseId: 'cb-missing' })).rejects.toThrow(
      /FOREIGN KEY/i
    );
  });

  test('fresh schema: deleting the parent codebase cascades to its bindings (ON DELETE CASCADE)', async () => {
    db = createTestDb();
    await insertCodebase(db, 'cb-1');
    await insertBinding('wpb-1');

    await db.query('DELETE FROM remote_agent_codebases WHERE id = $1', ['cb-1']);

    const result = await db.query(
      'SELECT id FROM remote_agent_workflow_provider_bindings WHERE id = $1',
      ['wpb-1']
    );
    expect(result.rows).toHaveLength(0);
  });

  // 3.1-INT-002 [P1] — Existing SQLite DB adds the table without data loss.
  // Risk: R-007, R-013.
  test('upgrade: constructing SqliteAdapter against a pre-existing DB (missing the new table) adds it without touching unrelated tables', async () => {
    const dbPath = join(
      import.meta.dir,
      `.test-sqlite-pre-binding-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    );
    currentDbPath = dbPath;

    // Seed a pre-Story-3.1 database: codebases table exists, has a row, but
    // remote_agent_workflow_provider_bindings does not exist at all.
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE remote_agent_codebases (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        name TEXT NOT NULL,
        default_cwd TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO remote_agent_codebases (id, name, default_cwd) VALUES ('cb-preexisting', 'pre', '/tmp/pre');
    `);
    raw.close();

    db = new SqliteAdapter(dbPath);
    const cols = raw_pragma(dbPath, 'remote_agent_workflow_provider_bindings');
    expect(cols).toContain('provider');
    expect(cols).toContain('name');
    expect(cols).toContain('event_route');
    expect(cols).toContain('signing_secret');

    // The pre-existing row must survive the upgrade untouched.
    const preserved = await db.query('SELECT name FROM remote_agent_codebases WHERE id = $1', [
      'cb-preexisting',
    ]);
    expect(preserved.rows).toHaveLength(1);
  });

  // 3.1-INT-003 [P1] — Repeated SQLite init is idempotent. Risk: R-007, R-013.
  test('repeated construction against the same file is idempotent (no duplicate-table / duplicate-index errors)', async () => {
    db = createTestDb();
    await db.close();
    // Re-open the same file — createSchema()'s CREATE TABLE IF NOT EXISTS /
    // CREATE INDEX IF NOT EXISTS must not throw on the second pass.
    expect(() => {
      db = new SqliteAdapter(currentDbPath);
    }).not.toThrow();
    await insertCodebase(db, 'cb-1');
    await expect(insertBinding('wpb-1')).resolves.toBeUndefined();
  });

  test('fresh schema: signing_secret persists privately on provider bindings', async () => {
    db = createTestDb();
    await insertCodebase(db, 'cb-1');
    await insertBinding('wpb-1', { signingSecret: 'local-test-value' });

    const result = await db.query<{ signing_secret: string | null }>(
      `SELECT signing_secret FROM remote_agent_workflow_provider_bindings WHERE id = $1`,
      ['wpb-1']
    );

    expect(result.rows[0]?.signing_secret).toBe('local-test-value');
  });

  // ---------------------------------------------------------------------------
  // Concurrency / races — real temp SQLite DB, Promise.all-driven interleaving.
  // ---------------------------------------------------------------------------

  // 3.1-INT-005 [P0] — Concurrent duplicate creates produce one row and one
  // loser. Risk: R-003.
  test('two concurrent creates for the same (provider,name) leave exactly one row', async () => {
    db = createTestDb();
    await insertCodebase(db, 'cb-1');

    const attempt = (id: string): Promise<unknown> =>
      db.query(
        `INSERT INTO remote_agent_workflow_provider_bindings
         (id, provider, name, codebase_id, event_route, state)
         VALUES ($1, 'archon', 'workflow-engine-primary', 'cb-1', 'https://hermes.example/events/x', 'active')
         ON CONFLICT (provider, name) DO NOTHING`,
        [id]
      );

    await Promise.all([attempt('wpb-a'), attempt('wpb-b')]);

    const rows = await db.query(
      `SELECT id FROM remote_agent_workflow_provider_bindings WHERE provider = 'archon' AND name = 'workflow-engine-primary'`
    );
    expect(rows.rows).toHaveLength(1);
  });

  // 3.1-INT-006 [P0] — Concurrent create/update yields only legal outcomes
  // and no duplicate. Risk: R-003, R-006.
  test('a create racing an update on the not-yet-created binding never produces two rows', async () => {
    db = createTestDb();
    await insertCodebase(db, 'cb-1');

    const create = db.query(
      `INSERT INTO remote_agent_workflow_provider_bindings
       (id, provider, name, codebase_id, event_route, state)
       VALUES ('wpb-race', 'archon', 'workflow-engine-primary', 'cb-1', 'https://hermes.example/events/x', 'active')
       ON CONFLICT (provider, name) DO NOTHING`
    );
    const update = db.query(
      `UPDATE remote_agent_workflow_provider_bindings
       SET event_route = 'https://hermes.example/events/updated'
       WHERE provider = 'archon' AND name = 'workflow-engine-primary'`
    );

    await Promise.allSettled([create, update]);

    const rows = await db.query(
      `SELECT id FROM remote_agent_workflow_provider_bindings WHERE provider = 'archon' AND name = 'workflow-engine-primary'`
    );
    expect(rows.rows.length).toBeLessThanOrEqual(1);
  });

  // 3.1-INT-007 [P0] — Create→update→create preserves distinct command
  // semantics. Risk: R-003.
  test('create, then update, then a second create for the same (provider,name) — the second create still fails', async () => {
    db = createTestDb();
    await insertCodebase(db, 'cb-1');
    await insertBinding('wpb-1');

    await db.query(
      `UPDATE remote_agent_workflow_provider_bindings SET event_route = $1 WHERE provider = 'archon' AND name = 'workflow-engine-primary'`,
      ['https://hermes.example/events/v2']
    );

    const secondCreate = await db.query(
      `INSERT INTO remote_agent_workflow_provider_bindings
       (id, provider, name, codebase_id, event_route, state)
       VALUES ('wpb-2', 'archon', 'workflow-engine-primary', 'cb-1', 'https://hermes.example/events/v3', 'active')
       ON CONFLICT (provider, name) DO NOTHING`
    );
    expect(secondCreate.rowCount).toBe(0);

    const rows = await db.query<{ event_route: string }>(
      `SELECT event_route FROM remote_agent_workflow_provider_bindings WHERE provider = 'archon' AND name = 'workflow-engine-primary'`
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.event_route).toBe('https://hermes.example/events/v2');
  });

  // 3.1-INT-008 [P1] — Concurrent rotates are monotonic. Risk: R-006.
  test('N concurrent rotate UPDATEs each increment binding_version by exactly 1 in total (no lost update)', async () => {
    db = createTestDb();
    await insertCodebase(db, 'cb-1');
    await insertBinding('wpb-1');

    const rotate = (): Promise<unknown> =>
      db.query(
        `UPDATE remote_agent_workflow_provider_bindings
         SET binding_version = binding_version + 1, state = 'rotated'
         WHERE provider = 'archon' AND name = 'workflow-engine-primary'`
      );

    await Promise.all([rotate(), rotate(), rotate()]);

    const rows = await db.query<{ binding_version: number }>(
      `SELECT binding_version FROM remote_agent_workflow_provider_bindings WHERE provider = 'archon' AND name = 'workflow-engine-primary'`
    );
    // 3 concurrent +1 UPDATEs starting from version 1 must land on exactly 4 —
    // a lost update would land lower.
    expect(rows.rows[0]?.binding_version).toBe(4);
  });

  // 3.1-INT-009 [P1] — Rotate racing disable has a serializable final state.
  // Risk: R-006, R-009.
  test('a rotate racing a disable on the same binding leaves a single coherent final state (never both half-applied)', async () => {
    db = createTestDb();
    await insertCodebase(db, 'cb-1');
    await insertBinding('wpb-1');

    const rotate = db.query(
      `UPDATE remote_agent_workflow_provider_bindings
       SET binding_version = binding_version + 1, state = 'rotated'
       WHERE provider = 'archon' AND name = 'workflow-engine-primary'`
    );
    const disable = db.query(
      `UPDATE remote_agent_workflow_provider_bindings
       SET state = 'disabled'
       WHERE provider = 'archon' AND name = 'workflow-engine-primary'`
    );

    await Promise.allSettled([rotate, disable]);

    const rows = await db.query<{ state: string }>(
      `SELECT state FROM remote_agent_workflow_provider_bindings WHERE provider = 'archon' AND name = 'workflow-engine-primary'`
    );
    expect(rows.rows).toHaveLength(1);
    expect(['rotated', 'disabled']).toContain(rows.rows[0]?.state);
  });

  // 3.1-INT-010 [P1] — Duplicate disable follows ratified idempotent
  // semantics and retains one row. Risk: R-009.
  test('disabling an already-disabled binding twice retains exactly one row with state=disabled', async () => {
    db = createTestDb();
    await insertCodebase(db, 'cb-1');
    await insertBinding('wpb-1', { state: 'disabled' });

    await db.query(
      `UPDATE remote_agent_workflow_provider_bindings SET state = 'disabled' WHERE provider = 'archon' AND name = 'workflow-engine-primary'`
    );
    await db.query(
      `UPDATE remote_agent_workflow_provider_bindings SET state = 'disabled' WHERE provider = 'archon' AND name = 'workflow-engine-primary'`
    );

    const rows = await db.query<{ state: string }>(
      `SELECT state FROM remote_agent_workflow_provider_bindings WHERE provider = 'archon' AND name = 'workflow-engine-primary'`
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.state).toBe('disabled');
  });
});

describe('remote_agent_workflow_event_outbox (Story 3.5)', () => {
  let db: SqliteAdapter;

  afterEach(async () => {
    if (db) {
      await db.close();
    }
    try {
      unlinkSync(currentDbPath);
    } catch {
      /* may not exist */
    }
    try {
      unlinkSync(currentDbPath + '-wal');
    } catch {
      /* may not exist */
    }
    try {
      unlinkSync(currentDbPath + '-shm');
    } catch {
      /* may not exist */
    }
  });

  async function insertRun(): Promise<void> {
    await insertCodebase(db, 'cb-1');
    await db.query(
      `INSERT INTO remote_agent_conversations (id, platform_type, platform_conversation_id)
       VALUES ($1, $2, $3)`,
      ['conv-1', 'web', 'conv-1']
    );
    await db.query(
      `INSERT INTO remote_agent_workflow_runs
       (id, conversation_id, codebase_id, workflow_name, user_message, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['run-1', 'conv-1', 'cb-1', 'bmad-dev-story', 'ship it', 'running']
    );
    await db.query(
      `INSERT INTO remote_agent_workflow_provider_bindings
       (id, provider, name, codebase_id, event_route, signing_secret, state)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        'wpb-1',
        'archon',
        'workflow-engine-primary',
        'cb-1',
        'https://hermes.example/events',
        'local-test-value',
        'active',
      ]
    );
  }

  test('fresh schema: outbox row and append-only attempt row persist exact request body', async () => {
    db = createTestDb();
    await insertRun();
    const body = '{"schemaVersion":"workflow-event-envelope.v1","eventId":"evt-1"}';

    await db.query(
      `INSERT INTO remote_agent_workflow_event_outbox
       (id, event_id, idempotency_key, event_type, workflow_run_id, codebase_id,
        binding_id, event_route, event_body, status, next_attempt_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        'outbox-1',
        'evt-1',
        'archon:workflow-engine-primary:evt-1',
        'workflow.run.completed',
        'run-1',
        'cb-1',
        'wpb-1',
        'https://hermes.example/events',
        body,
        'pending',
        '2026-07-25T00:00:00.000Z',
      ]
    );
    await db.query(
      `INSERT INTO remote_agent_workflow_event_delivery_attempts
       (id, outbox_event_id, attempt_number, request_url, request_method,
        request_headers, request_body, started_at, outcome)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        'attempt-1',
        'outbox-1',
        1,
        'https://hermes.example/events',
        'POST',
        '{"X-Request-ID":"archon:workflow-engine-primary:evt-1"}',
        body,
        '2026-07-25T00:00:00.000Z',
        'pending',
      ]
    );

    const outbox = await db.query<{ event_body: string; status: string }>(
      'SELECT event_body, status FROM remote_agent_workflow_event_outbox WHERE id = $1',
      ['outbox-1']
    );
    const attempts = await db.query<{ request_body: string; outcome: string }>(
      'SELECT request_body, outcome FROM remote_agent_workflow_event_delivery_attempts WHERE id = $1',
      ['attempt-1']
    );

    expect(outbox.rows[0]).toEqual({ event_body: body, status: 'pending' });
    expect(attempts.rows[0]).toEqual({ request_body: body, outcome: 'pending' });
  });

  test('fresh schema: due and attempt indexes exist', async () => {
    db = createTestDb();

    const indexes = raw_indexes(currentDbPath);

    expect(indexes).toContain('idx_workflow_event_outbox_due');
    expect(indexes).toContain('idx_workflow_event_outbox_run');
    expect(indexes).toContain('idx_workflow_event_delivery_attempts_outbox');
  });
});

function raw_pragma(dbPath: string, table: string): string[] {
  const raw = new Database(dbPath, { readonly: true });
  try {
    const rows = raw.prepare(`PRAGMA table_info('${table}')`).all() as { name: string }[];
    return rows.map(r => r.name);
  } finally {
    raw.close();
  }
}

function raw_indexes(dbPath: string): string[] {
  const raw = new Database(dbPath, { readonly: true });
  try {
    const rows = raw.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as {
      name: string;
    }[];
    return rows.map(r => r.name);
  } finally {
    raw.close();
  }
}

function raw_query(dbPath: string, sql: string): unknown[] {
  const raw = new Database(dbPath, { readonly: true });
  try {
    return raw.prepare(sql).all();
  } finally {
    raw.close();
  }
}
