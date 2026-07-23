#!/usr/bin/env node
import { Command } from 'commander';
import { Pool } from 'pg';
import {
  version,
  classifySchema,
  detectSchemaDrift,
  buildForceRedactSet,
  formatDriftWarnings,
  StreamMaskingTransformer,
  DAGSubsettingEngine,
  type MaskingRule,
  type ClassificationResult,
} from '@envshield/core';

// ─── CLI Program ──────────────────────────────────────────────────────────────

const program = new Command();

program
  .name('envshield')
  .description('Compliance-driven environment sync & auto-masking CLI')
  .version(version);

// ─── envshield scan ───────────────────────────────────────────────────────────

program
  .command('scan')
  .description('Introspect a database schema and output a PII risk report')
  .requiredOption('--source <url>', 'PostgreSQL connection URL of the source database')
  .option('--control-plane <url>', 'EnvShield Control Plane base URL', 'http://localhost:3001')
  .action(async (opts: { source: string; controlPlane: string }) => {
    console.log('[EnvShield] 🔍 Starting schema scan...\n');

    const pool = new Pool({ connectionString: opts.source });

    try {
      // ── Step 1: Introspect schema ────────────────────────────────────────────
      console.log('[EnvShield] Step 1/2 — Introspecting schema...');
      const schema = await introspectSchema(pool);
      const totalColumns = schema.tables.reduce((sum, t) => sum + t.columns.length, 0);
      console.log(`           Found ${schema.tables.length} tables, ${totalColumns} columns.\n`);

      // ── Step 2: Classify PII (with LLM fallback via Control Plane) ──────────
      console.log('[EnvShield] Step 2/2 — Classifying PII...');
      const llmFn = buildLlmClassifyFn(opts.controlPlane);
      const results = await classifySchema(schema, pool, llmFn);

      // ── Print report ─────────────────────────────────────────────────────────
      console.log('\n' + formatScanReport(results));
    } finally {
      await pool.end();
    }
  });

// ─── envshield sync ───────────────────────────────────────────────────────────

program
  .command('sync')
  .description('Stream-mask a subset of the source database into the target database')
  .requiredOption('--source <url>', 'PostgreSQL connection URL of the source database')
  .requiredOption('--target <url>', 'PostgreSQL connection URL of the target database')
  .option('--subset <percentage>', 'Percentage of rows to sample (e.g. 5)', '5')
  .option('--api-key <key>', 'EnvShield project API key', process.env['ENVSHIELD_API_KEY'])
  .option('--control-plane <url>', 'EnvShield Control Plane base URL', 'http://localhost:3001')
  .action(async (opts: {
    source: string;
    target: string;
    subset: string;
    apiKey?: string;
    controlPlane: string;
  }) => {
    console.log('[EnvShield] 🚀 Starting sync pipeline...\n');

    const sourcePool = new Pool({ connectionString: opts.source });

    try {
      // ── Step 1: Introspect live schema ───────────────────────────────────────
      console.log('[EnvShield] Step 1/4 — Introspecting source schema...');
      const liveSchema = await introspectSchema(sourcePool);

      // ── Step 2: Fetch stored masking rules from Control Plane ────────────────
      console.log('[EnvShield] Step 2/4 — Fetching masking rules from Control Plane...');
      const storedRules = await fetchStoredRules(opts.controlPlane, opts.apiKey);

      // ── Step 3: Schema drift detection ──────────────────────────────────────
      console.log('[EnvShield] Step 3/4 — Checking for schema drift...');
      const driftReport = detectSchemaDrift(liveSchema, storedRules);
      const forceRedactSet = buildForceRedactSet(driftReport);

      console.log(formatDriftWarnings(driftReport));

      // Emit drift warning to Control Plane audit log if drift detected
      if (driftReport.newColumns.length > 0) {
        await emitDriftWarning(opts.controlPlane, opts.apiKey, driftReport.newColumns);
      }

      // ── Step 4: Sync (subsetting + masking) ─────────────────────────────────
      console.log(`\n[EnvShield] Step 4/4 — Streaming ${opts.subset}% subset with masking...`);
      console.log(`           Force-redacting ${forceRedactSet.size} drifted column(s).`);

      const targetPool = new Pool({ connectionString: opts.target });
      try {
        const relations = await fetchForeignKeys(sourcePool);
        const subsetPct = parseFloat(opts.subset) || 5;
        
        const dag = new DAGSubsettingEngine({
          rootTable: 'users',
          subsetPercentage: subsetPct,
          relations,
        });

        const tableNames = liveSchema.tables.map(t => t.name);
        const order = dag.getExecutionOrder(tableNames);
        const parentIds: Record<string, Set<any>> = {};

        const strategies: Record<string, any> = {};
        for (const rule of storedRules) {
          strategies[`${rule.tableName}.${rule.columnName}`] = rule.strategy;
        }

        for (const table of order) {
          console.log(`           Syncing table: ${table}...`);
          await targetPool.query(`TRUNCATE TABLE "${table}" CASCADE`).catch(() => {});

          // Fetch rows from source
          let querySql = `SELECT * FROM "${table}"`;
          let queryValues: any[] = [];

          if (table === 'users') {
            querySql = `SELECT * FROM "${table}" WHERE random() <= $1`;
            queryValues = [subsetPct / 100];
          } else {
            const parentRels = relations.filter(r => r.fromTable === table);
            const parentClauses: string[] = [];
            for (const rel of parentRels) {
              const allowed = parentIds[rel.toTable];
              if (allowed && allowed.size > 0) {
                const idList = Array.from(allowed).map((_, i) => `$${queryValues.length + i + 1}`).join(',');
                parentClauses.push(`"${rel.fromColumn}" IN (${idList})`);
                queryValues.push(...Array.from(allowed));
              }
            }
            if (parentClauses.length > 0) {
              querySql = `SELECT * FROM "${table}" WHERE ${parentClauses.join(' OR ')}`;
            } else if (parentRels.length > 0) {
              querySql = `SELECT * FROM "${table}" WHERE 1=0`;
            } else {
              querySql = `SELECT * FROM "${table}" WHERE random() <= $1`;
              queryValues = [subsetPct / 100];
            }
          }

          const rowsRes = await sourcePool.query(querySql, queryValues);
          const transformer = new StreamMaskingTransformer(table, {
            strategies,
            forceRedactSet,
          });

          parentIds[table] = new Set();
          const pkCols = liveSchema.tables.find(t => t.name === table)?.columns.filter(c => c.isPrimaryKey).map(c => c.name) || [];

          for (const row of rowsRes.rows) {
            const masked = await new Promise<any>((resolve, reject) => {
              transformer._transform(row, 'utf8', (err, data) => {
                if (err) reject(err);
                else resolve(data);
              });
            });

            if (pkCols.length > 0) {
              for (const pkCol of pkCols) {
                if (masked[pkCol] !== undefined && masked[pkCol] !== null) {
                  parentIds[table].add(masked[pkCol]);
                }
              }
            }

            const colNames = Object.keys(masked);
            if (colNames.length > 0) {
              const placeholders = colNames.map((_, i) => `$${i + 1}`).join(',');
              const insertSql = `INSERT INTO "${table}" (${colNames.map(c => `"${c}"`).join(',')}) VALUES (${placeholders})`;
              await targetPool.query(insertSql, Object.values(masked));
            }
          }
          console.log(`           Synced ${rowsRes.rows.length} row(s) for table: ${table}.`);
        }
        console.log('\n[EnvShield] ✔  Sync pipeline complete.');
      } finally {
        await targetPool.end();
      }
    } finally {
      await sourcePool.end();
    }
  });

// ─── Shared utilities ─────────────────────────────────────────────────────────

/**
 * Minimal introspection query — returns a SchemaGraph from information_schema.
 * Full implementation lives in packages/core/src/introspection (Phase 2).
 */
async function introspectSchema(pool: Pool) {
  const tablesRes = await pool.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);

  const tables = await Promise.all(
    tablesRes.rows.map(async ({ table_name }) => {
      const colsRes = await pool.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [table_name]);

      const pkRes = await pool.query<{ column_name: string }>(`
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema    = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = 'public'
          AND tc.table_name = $1
      `, [table_name]);

      const pkColumns = new Set(pkRes.rows.map((r) => r.column_name));

      return {
        name: table_name,
        columns: colsRes.rows.map((col) => ({
          name: col.column_name,
          dataType: col.data_type,
          isNullable: col.is_nullable === 'YES',
          isPrimaryKey: pkColumns.has(col.column_name),
          isForeignKey: false, // FK graph built in Phase 2 DAG engine
        })),
      };
    })
  );

  return { tables };
}

/** Fetches stored masking rules from the Control Plane API. */
async function fetchStoredRules(controlPlaneUrl: string, apiKey?: string): Promise<MaskingRule[]> {
  try {
    const res = await fetch(`${controlPlaneUrl}/api/v1/rules/fetch`, {
      headers: apiKey ? { 'x-api-key': apiKey } : {},
    });
    if (!res.ok) {
      console.warn(`[EnvShield] Could not fetch rules (${res.status}). Treating all columns as unclassified.`);
      return [];
    }
    const data = await res.json() as { rules: MaskingRule[] };
    return data.rules ?? [];
  } catch {
    console.warn('[EnvShield] Control Plane unreachable. Treating all columns as unclassified.');
    return [];
  }
}

/** Emits a drift warning payload to the Control Plane audit log. */
async function emitDriftWarning(
  controlPlaneUrl: string,
  apiKey: string | undefined,
  newColumns: Array<{ table: string; column: string; warningMessage: string }>
): Promise<void> {
  try {
    await fetch(`${controlPlaneUrl}/api/v1/audit/log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
      },
      body: JSON.stringify({
        eventType: 'SCHEMA_DRIFT',
        driftedColumns: newColumns,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    // Non-fatal: drift warning emission failure should not block the sync
    console.warn('[EnvShield] Could not emit drift warning to Control Plane.');
  }
}

/** Builds an LLM classify function that calls the Control Plane /ai/classify route. */
function buildLlmClassifyFn(controlPlaneUrl: string) {
  return async (columns: Parameters<NonNullable<Parameters<typeof classifySchema>[2]>>[0]) => {
    const res = await fetch(`${controlPlaneUrl}/api/v1/ai/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columns }),
    });
    if (!res.ok) throw new Error(`Control Plane returned ${res.status}`);
    const data = await res.json() as { results: ClassificationResult[] };
    return data.results;
  };
}

/** Formats the scan results as a human-readable table for the terminal. */
function formatScanReport(results: ClassificationResult[]): string {
  const piiResults = results.filter((r) => r.category !== 'UNKNOWN');
  const unknownCount = results.length - piiResults.length;

  const lines: string[] = [
    '─'.repeat(80),
    `  EnvShield PII Scan Report`,
    '─'.repeat(80),
    `  ${'TABLE.COLUMN'.padEnd(40)} ${'CATEGORY'.padEnd(14)} ${'STRATEGY'.padEnd(12)} SOURCE`,
    '─'.repeat(80),
  ];

  for (const r of results) {
    const key = `${r.table}.${r.column}`.padEnd(40);
    const cat = r.category.padEnd(14);
    const strat = r.strategy.padEnd(12);
    const flag = r.category === 'UNKNOWN' ? '' : '⚠ ';
    lines.push(`  ${flag}${key} ${cat} ${strat} ${r.source}`);
  }

  lines.push('─'.repeat(80));
  lines.push(`  Total: ${results.length} columns | PII detected: ${piiResults.length} | Unclassified: ${unknownCount}`);
  lines.push('─'.repeat(80));

  return lines.join('\n');
}

/** Query database to get foreign key relationships */
async function fetchForeignKeys(pool: Pool): Promise<Array<{ fromTable: string; fromColumn: string; toTable: string; toColumn: string }>> {
  try {
    const res = await pool.query<{
      from_table: string;
      from_column: string;
      to_table: string;
      to_column: string;
    }>(`
      SELECT
          tc.table_name AS from_table,
          kcu.column_name AS from_column,
          ccu.table_name AS to_table,
          ccu.column_name AS to_column
      FROM
          information_schema.table_constraints AS tc
          JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    `);
    return res.rows.map(r => ({
      fromTable: r.from_table,
      fromColumn: r.from_column,
      toTable: r.to_table,
      toColumn: r.to_column,
    }));
  } catch {
    return [];
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

program.parse(process.argv);
