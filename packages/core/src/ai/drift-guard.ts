import type { SchemaGraph } from './classifier.js';
import type { MaskingStrategy } from './classifier.js';

// ─── Stored rule shape (returned by GET /api/v1/rules/fetch) ─────────────────

export interface MaskingRule {
  id: string;
  projectId: string;
  tableName: string;
  columnName: string;
  strategy: MaskingStrategy;
  configJson: Record<string, unknown>;
}

// ─── Drift report types ───────────────────────────────────────────────────────

export interface DriftedColumn {
  table: string;
  column: string;
  /** Always 'redact' — fail-safe until the rule is reviewed by an engineer */
  appliedStrategy: 'redact';
  warningMessage: string;
}

export interface DriftReport {
  /** Columns present in the live DB that have NO stored masking rule */
  newColumns: DriftedColumn[];
  /** Columns that had rules but no longer exist in the live schema */
  removedColumns: Array<{ table: string; column: string }>;
  /** Columns that exist in both schema and rules (no action needed) */
  unchanged: Array<{ table: string; column: string }>;
}

// ─── Core drift detection ─────────────────────────────────────────────────────

/**
 * Compares the live database schema against the stored masking rules and
 * identifies columns that require attention:
 *
 * - **newColumns**: columns with no rule → will be force-redacted during sync
 * - **removedColumns**: rules that reference columns that no longer exist
 * - **unchanged**: columns with an existing, valid rule
 *
 * @param liveSchema   - Schema graph freshly introspected from the source DB
 * @param storedRules  - Masking rules fetched from the Control Plane API
 */
export function detectSchemaDrift(
  liveSchema: SchemaGraph,
  storedRules: MaskingRule[]
): DriftReport {
  // Build a lookup set of "table.column" keys that already have rules
  const ruleKeys = new Set(storedRules.map((r) => `${r.tableName}.${r.columnName}`));

  const newColumns: DriftedColumn[] = [];
  const unchanged: Array<{ table: string; column: string }> = [];
  const seenKeys = new Set<string>();

  for (const table of liveSchema.tables) {
    for (const column of table.columns) {
      // Primary keys are structural — they don't need masking rules
      if (column.isPrimaryKey) continue;

      const key = `${table.name}.${column.name}`;
      seenKeys.add(key);

      if (ruleKeys.has(key)) {
        unchanged.push({ table: table.name, column: column.name });
      } else {
        // New / unclassified column detected → trigger fail-safe
        newColumns.push({
          table: table.name,
          column: column.name,
          appliedStrategy: 'redact',
          warningMessage:
            `[DRIFT] Column "${table.name}.${column.name}" has no masking rule. ` +
            `Defaulting to REDACT for safety. Please review in the EnvShield dashboard.`,
        });
      }
    }
  }

  // Any rule key NOT seen in the live schema means the column was dropped
  const removedColumns: Array<{ table: string; column: string }> = [];
  for (const key of ruleKeys) {
    if (!seenKeys.has(key)) {
      const [table, ...rest] = key.split('.');
      removedColumns.push({ table, column: rest.join('.') });
    }
  }

  return { newColumns, removedColumns, unchanged };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns a Set of "table.column" keys for columns that must be force-redacted
 * due to schema drift. Use this inside the masking transformer to override
 * any configured strategy for drifted columns.
 */
export function buildForceRedactSet(report: DriftReport): Set<string> {
  return new Set(report.newColumns.map((c) => `${c.table}.${c.column}`));
}

/**
 * Formats drift warnings into a human-readable summary for CLI output.
 */
export function formatDriftWarnings(report: DriftReport): string {
  if (report.newColumns.length === 0 && report.removedColumns.length === 0) {
    return '✔  No schema drift detected.';
  }

  const lines: string[] = [];

  if (report.newColumns.length > 0) {
    lines.push(`⚠  ${report.newColumns.length} unclassified column(s) detected — auto-redacted:`);
    for (const col of report.newColumns) {
      lines.push(`   • ${col.table}.${col.column} → REDACT (fail-safe)`);
    }
  }

  if (report.removedColumns.length > 0) {
    lines.push(`ℹ  ${report.removedColumns.length} rule(s) reference dropped column(s):`);
    for (const col of report.removedColumns) {
      lines.push(`   • ${col.table}.${col.column} (no longer in schema)`);
    }
  }

  return lines.join('\n');
}
