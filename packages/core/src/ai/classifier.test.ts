import { describe, it, expect, vi, type Mock } from 'vitest';
import {
  classifySchema,
  type SchemaGraph,
  type LlmClassifyFn,
  type SchemaColumn,
} from './classifier.js';
import {
  detectSchemaDrift,
  buildForceRedactSet,
  formatDriftWarnings,
  type MaskingRule,
} from './drift-guard.js';
import type { Pool } from 'pg';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeMockPool(valuesByColumn: Record<string, string[]> = {}): Pool {
  return {
    query: vi.fn((_sql: string) => {
      const colMatch = (_sql as string).match(/SELECT "([^"]+)"::text/);
      const colName = colMatch?.[1] ?? '';
      const rows = (valuesByColumn[colName] ?? []).map((v) => ({ val: v }));
      return Promise.resolve({ rows });
    }),
  } as unknown as Pool;
}

function makeSchema(
  tables: Array<{
    name: string;
    columns: Array<Partial<SchemaColumn> & { name: string }>;
  }>
): SchemaGraph {
  return {
    tables: tables.map((t) => ({
      name: t.name,
      columns: t.columns.map((c) => ({
        dataType: 'varchar',
        isPrimaryKey: false,
        isForeignKey: false,
        isNullable: true,
        ...c,
      })),
    })),
  };
}

const EMPTY_POOL = makeMockPool();

// ─── Layer 1: Column-name regex ───────────────────────────────────────────────

describe('classifySchema — Layer 1 (column-name regex)', () => {
  it.each([
    ['email',       'users',    'EMAIL',       'hmac-hash'],
    ['password',    'users',    'PASSWORD',    'redact'],
    ['phone',       'contacts', 'PHONE',       'anonymize'],
    ['mobile',      'contacts', 'PHONE',       'anonymize'],
    ['ssn',         'hr',       'SSN',         'redact'],
    ['credit_card', 'payments', 'CREDIT_CARD', 'redact'],
    ['ip_address',  'sessions', 'IP_ADDRESS',  'redact'],
    ['first_name',  'users',    'NAME',        'anonymize'],
    ['last_name',   'users',    'NAME',        'anonymize'],
    ['full_name',   'users',    'NAME',        'anonymize'],
    ['address',     'users',    'ADDRESS',     'anonymize'],
    ['zip',         'users',    'ADDRESS',     'anonymize'],
    ['dob',         'profiles', 'DOB',         'redact'],
    ['date_of_birth','profiles','DOB',         'redact'],
  ] as const)(
    '%s → %s / %s',
    async (column, table, category, strategy) => {
      const schema = makeSchema([{ name: table, columns: [{ name: column }] }]);
      const results = await classifySchema(schema, EMPTY_POOL);
      expect(results).toContainEqual(
        expect.objectContaining({ column, category, strategy, confidence: 'HIGH', source: 'regex' })
      );
    }
  );

  it('skips primary key columns and marks them as UNKNOWN / keep / fallback', async () => {
    const schema = makeSchema([{ name: 'users', columns: [{ name: 'id', isPrimaryKey: true }] }]);
    const results = await classifySchema(schema, EMPTY_POOL);
    expect(results).toContainEqual(
      expect.objectContaining({ column: 'id', category: 'UNKNOWN', strategy: 'keep', source: 'fallback' })
    );
  });

  it('regex has priority over sample content — does not call pool for email column', async () => {
    const poolSpy = makeMockPool();
    const schema = makeSchema([{ name: 'users', columns: [{ name: 'email', dataType: 'varchar' }] }]);
    await classifySchema(schema, poolSpy);
    // Pool query should NOT be called for a regex-matched column
    expect((poolSpy.query as Mock)).not.toHaveBeenCalled();
  });
});

// ─── Layer 2: Sample-content inspection ──────────────────────────────────────

describe('classifySchema — Layer 2 (sample-content)', () => {
  it('classifies neutral-named column as EMAIL when content looks like emails', async () => {
    const schema = makeSchema([{ name: 'users', columns: [{ name: 'contact_info', dataType: 'text' }] }]);
    const pool = makeMockPool({
      contact_info: ['alice@example.com', 'bob@company.org', 'charlie@test.net', 'dave@foo.io', 'eve@bar.co'],
    });
    const results = await classifySchema(schema, pool);
    expect(results).toContainEqual(
      expect.objectContaining({ column: 'contact_info', category: 'EMAIL', source: 'sample-content', confidence: 'MEDIUM' })
    );
  });

  it('classifies neutral-named column as IP_ADDRESS from content', async () => {
    const schema = makeSchema([{ name: 'logs', columns: [{ name: 'origin', dataType: 'varchar' }] }]);
    const pool = makeMockPool({
      origin: ['192.168.1.1', '10.0.0.1', '172.16.0.100', '8.8.8.8', '1.1.1.1'],
    });
    const results = await classifySchema(schema, pool);
    expect(results).toContainEqual(
      expect.objectContaining({ column: 'origin', category: 'IP_ADDRESS', source: 'sample-content' })
    );
  });

  it('does NOT inspect non-text columns (integer)', async () => {
    const poolSpy = makeMockPool({ amount: ['100', '200'] });
    const schema = makeSchema([{ name: 'orders', columns: [{ name: 'amount', dataType: 'integer' }] }]);
    await classifySchema(schema, poolSpy);
    // Pool should not be queried for non-text column
    expect((poolSpy.query as Mock)).not.toHaveBeenCalled();
  });

  it('falls back to UNKNOWN when match rate is below 20%', async () => {
    const schema = makeSchema([{ name: 'posts', columns: [{ name: 'notes', dataType: 'text' }] }]);
    // Only 1 of 10 looks like an email → 10% < 20% threshold → should NOT classify
    const pool = makeMockPool({
      notes: ['hello', 'world', 'foo', 'bar', 'baz', 'qux', 'abc', 'def', 'ghi', 'user@example.com'],
    });
    const results = await classifySchema(schema, pool);
    const result = results.find((r) => r.column === 'notes');
    expect(result?.source).not.toBe('sample-content');
    expect(result?.category).toBe('UNKNOWN');
  });
});

// ─── Layer 3: LLM fallback ────────────────────────────────────────────────────

describe('classifySchema — Layer 3 (LLM fallback)', () => {
  it('calls llmClassifyFn for columns that pass both regex and content layers', async () => {
    const schema = makeSchema([{ name: 'users', columns: [{ name: 'bio_notes', dataType: 'text' }] }]);
    const llmFn: Mock<LlmClassifyFn> = vi.fn().mockResolvedValue([
      { table: 'users', column: 'bio_notes', category: 'UNKNOWN', confidence: 'LOW', strategy: 'keep', source: 'llm' },
    ]);
    const results = await classifySchema(schema, makeMockPool(), llmFn);
    expect(llmFn).toHaveBeenCalledOnce();
    expect(results).toContainEqual(
      expect.objectContaining({ column: 'bio_notes', source: 'llm' })
    );
  });

  it('receives the unclassified columns grouped in one batch call', async () => {
    const schema = makeSchema([{
      name: 'tbl',
      columns: [
        { name: 'col_a', dataType: 'text' },
        { name: 'col_b', dataType: 'text' },
      ],
    }]);
    const llmFn: Mock<LlmClassifyFn> = vi.fn().mockResolvedValue([
      { table: 'tbl', column: 'col_a', category: 'UNKNOWN', confidence: 'NONE', strategy: 'keep', source: 'llm' },
      { table: 'tbl', column: 'col_b', category: 'UNKNOWN', confidence: 'NONE', strategy: 'keep', source: 'llm' },
    ]);
    await classifySchema(schema, makeMockPool(), llmFn);
    expect(llmFn).toHaveBeenCalledOnce(); // single batch, not per-column
    const callArg = llmFn.mock.calls[0]![0];
    expect(callArg).toHaveLength(2);
  });

  it('applies hard fallback (UNKNOWN / keep) when LLM throws', async () => {
    const schema = makeSchema([{ name: 'users', columns: [{ name: 'mystery_col', dataType: 'text' }] }]);
    const failingLlm: LlmClassifyFn = vi.fn().mockRejectedValue(new Error('LLM timeout'));
    const results = await classifySchema(schema, makeMockPool(), failingLlm);
    expect(results).toContainEqual(
      expect.objectContaining({ column: 'mystery_col', category: 'UNKNOWN', strategy: 'keep', source: 'fallback' })
    );
  });

  it('applies hard fallback when no llmClassifyFn is provided', async () => {
    const schema = makeSchema([{ name: 'users', columns: [{ name: 'ambiguous_field', dataType: 'text' }] }]);
    const results = await classifySchema(schema, makeMockPool()); // no LLM fn
    expect(results).toContainEqual(
      expect.objectContaining({ column: 'ambiguous_field', source: 'fallback' })
    );
  });
});

// ─── Drift guard ──────────────────────────────────────────────────────────────

describe('detectSchemaDrift', () => {
  const storedRules: MaskingRule[] = [
    { id: '1', projectId: 'p1', tableName: 'users', columnName: 'email',    strategy: 'hmac-hash', configJson: {} },
    { id: '2', projectId: 'p1', tableName: 'users', columnName: 'password', strategy: 'redact',    configJson: {} },
  ];

  it('reports no drift when live schema matches stored rules exactly', () => {
    const schema = makeSchema([{ name: 'users', columns: [{ name: 'email' }, { name: 'password' }] }]);
    const report = detectSchemaDrift(schema, storedRules);
    expect(report.newColumns).toHaveLength(0);
    expect(report.removedColumns).toHaveLength(0);
    expect(report.unchanged).toHaveLength(2);
  });

  it('detects a new unclassified column with appliedStrategy = redact', () => {
    const schema = makeSchema([{
      name: 'users',
      columns: [{ name: 'email' }, { name: 'password' }, { name: 'secret_token' }],
    }]);
    const report = detectSchemaDrift(schema, storedRules);
    expect(report.newColumns).toHaveLength(1);
    expect(report.newColumns[0]).toMatchObject({
      table: 'users',
      column: 'secret_token',
      appliedStrategy: 'redact',
    });
    expect(report.newColumns[0]!.warningMessage).toMatch(/\[DRIFT\]/);
  });

  it('reports removed columns when a rule references a dropped column', () => {
    const schema = makeSchema([{ name: 'users', columns: [{ name: 'email' }] }]); // 'password' dropped
    const report = detectSchemaDrift(schema, storedRules);
    expect(report.removedColumns).toContainEqual({ table: 'users', column: 'password' });
  });

  it('ignores primary key columns during drift detection', () => {
    const schema = makeSchema([{
      name: 'users',
      columns: [
        { name: 'id', isPrimaryKey: true },
        { name: 'email' },
        { name: 'password' },
      ],
    }]);
    const report = detectSchemaDrift(schema, storedRules);
    // 'id' is PK → should NOT appear as a drifted column
    const idDrift = report.newColumns.find((c) => c.column === 'id');
    expect(idDrift).toBeUndefined();
  });

  it('handles an empty rules array — all non-PK columns are drifted', () => {
    const schema = makeSchema([{ name: 'users', columns: [{ name: 'email' }, { name: 'password' }] }]);
    const report = detectSchemaDrift(schema, []);
    expect(report.newColumns).toHaveLength(2);
  });

  it('handles an empty schema — all rules appear as removed', () => {
    const schema: SchemaGraph = { tables: [] };
    const report = detectSchemaDrift(schema, storedRules);
    expect(report.removedColumns).toHaveLength(2);
  });
});

// ─── buildForceRedactSet ──────────────────────────────────────────────────────

describe('buildForceRedactSet', () => {
  it('returns a Set with "table.column" keys for drifted columns', () => {
    const schema = makeSchema([{
      name: 'users',
      columns: [{ name: 'email' }, { name: 'password' }, { name: 'new_col' }],
    }]);
    const storedRules: MaskingRule[] = [
      { id: '1', projectId: 'p1', tableName: 'users', columnName: 'email',    strategy: 'hmac-hash', configJson: {} },
      { id: '2', projectId: 'p1', tableName: 'users', columnName: 'password', strategy: 'redact',    configJson: {} },
    ];
    const report = detectSchemaDrift(schema, storedRules);
    const forceRedact = buildForceRedactSet(report);
    expect(forceRedact.has('users.new_col')).toBe(true);
    expect(forceRedact.has('users.email')).toBe(false);
    expect(forceRedact.has('users.password')).toBe(false);
  });
});

// ─── formatDriftWarnings ──────────────────────────────────────────────────────

describe('formatDriftWarnings', () => {
  it('returns a no-drift message when the report is clean', () => {
    const report = { newColumns: [], removedColumns: [], unchanged: [] };
    expect(formatDriftWarnings(report)).toContain('No schema drift detected');
  });

  it('lists drifted columns with REDACT label', () => {
    const schema = makeSchema([{
      name: 'users',
      columns: [{ name: 'email' }, { name: 'new_secret' }],
    }]);
    const rules: MaskingRule[] = [
      { id: '1', projectId: 'p1', tableName: 'users', columnName: 'email', strategy: 'hmac-hash', configJson: {} },
    ];
    const report = detectSchemaDrift(schema, rules);
    const output = formatDriftWarnings(report);
    expect(output).toContain('new_secret');
    expect(output).toContain('REDACT');
  });

  it('lists removed columns', () => {
    const schema = makeSchema([{ name: 'users', columns: [{ name: 'email' }] }]);
    const rules: MaskingRule[] = [
      { id: '1', projectId: 'p1', tableName: 'users', columnName: 'email',    strategy: 'hmac-hash', configJson: {} },
      { id: '2', projectId: 'p1', tableName: 'users', columnName: 'old_field', strategy: 'redact',   configJson: {} },
    ];
    const report = detectSchemaDrift(schema, rules);
    const output = formatDriftWarnings(report);
    expect(output).toContain('old_field');
  });
});
