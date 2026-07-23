import type { Pool } from 'pg';

// ─── Shared schema types (produced by Phase 2 Introspection Engine) ───────────

export interface SchemaColumn {
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
}

export interface SchemaTable {
  name: string;
  columns: SchemaColumn[];
}

export interface SchemaGraph {
  tables: SchemaTable[];
}

// ─── PII types ────────────────────────────────────────────────────────────────

export type PiiCategory =
  | 'EMAIL'
  | 'PHONE'
  | 'SSN'
  | 'CREDIT_CARD'
  | 'IP_ADDRESS'
  | 'PASSWORD'
  | 'NAME'
  | 'ADDRESS'
  | 'DOB'
  | 'UNKNOWN';

export type MaskingStrategy = 'hmac-hash' | 'anonymize' | 'redact' | 'keep';
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export interface ClassificationResult {
  table: string;
  column: string;
  category: PiiCategory;
  confidence: ConfidenceLevel;
  strategy: MaskingStrategy;
  /** The layer that produced this classification */
  source: 'regex' | 'sample-content' | 'llm' | 'fallback';
}

/** Signature for an optional LLM fallback function (injected from apps/control-plane) */
export type LlmClassifyFn = (
  columns: Array<{
    table: string;
    column: string;
    dataType: string;
    sampleValues: string[];
  }>
) => Promise<ClassificationResult[]>;

// ─── Layer 1: Column-name regex rules ────────────────────────────────────────

interface NameRule {
  pattern: RegExp;
  category: PiiCategory;
  strategy: MaskingStrategy;
}

const NAME_RULES: NameRule[] = [
  { pattern: /\bemail\b/i,                                            category: 'EMAIL',       strategy: 'hmac-hash'  },
  { pattern: /\bphone\b|\bmobile\b|\btel\b|\bcellphone\b/i,          category: 'PHONE',       strategy: 'anonymize'  },
  { pattern: /\bssn\b|\bsocial_security\b|\bsocial_sec\b/i,          category: 'SSN',         strategy: 'redact'     },
  { pattern: /\bcard_number\b|\bcredit_card\b|\bpan\b|\bcard_no\b/i, category: 'CREDIT_CARD', strategy: 'redact'     },
  { pattern: /\bip_address\b|\bip_addr\b|\bremote_ip\b|\bclient_ip\b/i, category: 'IP_ADDRESS', strategy: 'redact'  },
  { pattern: /\bpassword\b|\bpasswd\b|\bpwd\b|\bhashed_password\b/i, category: 'PASSWORD',    strategy: 'redact'     },
  { pattern: /\bfirst_name\b|\blast_name\b|\bfull_name\b|\bdisplay_name\b/i, category: 'NAME', strategy: 'anonymize' },
  { pattern: /\baddress\b|\bstreet\b|\bcity\b|\bzip\b|\bpostal_code\b/i, category: 'ADDRESS', strategy: 'anonymize' },
  { pattern: /\bdob\b|\bdate_of_birth\b|\bbirthday\b|\bbirth_date\b/i, category: 'DOB',       strategy: 'redact'     },
];

// ─── Layer 2: Sample-content regex validators ─────────────────────────────────

interface ContentRule {
  pattern: RegExp;
  category: PiiCategory;
  strategy: MaskingStrategy;
}

const CONTENT_RULES: ContentRule[] = [
  { pattern: /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/,        category: 'EMAIL',       strategy: 'hmac-hash' },
  { pattern: /^(\d{1,3}\.){3}\d{1,3}$/,               category: 'IP_ADDRESS',  strategy: 'redact'    },
  { pattern: /^\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}$/, category: 'CREDIT_CARD', strategy: 'redact'   },
  { pattern: /^\d{3}-\d{2}-\d{4}$/,                   category: 'SSN',         strategy: 'redact'    },
  { pattern: /^(\+?\d[\d\s\-().]{6,}\d)$/,            category: 'PHONE',       strategy: 'anonymize' },
];

/** Minimum fraction of sample values that must match to trigger content classification. */
const CONTENT_MATCH_THRESHOLD = 0.2;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function classifyByName(
  columnName: string
): Pick<ClassificationResult, 'category' | 'strategy'> | null {
  for (const rule of NAME_RULES) {
    if (rule.pattern.test(columnName)) {
      return { category: rule.category, strategy: rule.strategy };
    }
  }
  return null;
}

function classifyByContent(
  samples: string[]
): Pick<ClassificationResult, 'category' | 'strategy'> | null {
  if (samples.length === 0) return null;

  const counts = new Map<PiiCategory, { count: number; strategy: MaskingStrategy }>();

  for (const value of samples) {
    const trimmed = value.trim();
    for (const rule of CONTENT_RULES) {
      if (rule.pattern.test(trimmed)) {
        const prev = counts.get(rule.category);
        counts.set(rule.category, {
          count: (prev?.count ?? 0) + 1,
          strategy: rule.strategy,
        });
        break; // only count first matching rule per value
      }
    }
  }

  if (counts.size === 0) return null;

  // Pick the category with the highest match count
  let best: { category: PiiCategory; count: number; strategy: MaskingStrategy } | null = null;
  for (const [category, { count, strategy }] of counts.entries()) {
    if (!best || count > best.count) best = { category, count, strategy };
  }

  const matchRate = best!.count / samples.length;
  if (matchRate < CONTENT_MATCH_THRESHOLD) return null;

  return { category: best!.category, strategy: best!.strategy };
}

async function fetchSamples(
  pool: Pool,
  tableName: string,
  columnName: string,
  limit = 100
): Promise<string[]> {
  try {
    const res = await pool.query<Record<string, unknown>>(
      `SELECT "${columnName}"::text AS val FROM "${tableName}" WHERE "${columnName}" IS NOT NULL LIMIT $1`,
      [limit]
    );
    return res.rows.map((row) => String(row['val'] ?? ''));
  } catch {
    // Table or column may not yet exist in test environments
    return [];
  }
}

// ─── Main classifier ──────────────────────────────────────────────────────────

/**
 * Classifies every column in `schema` for PII risk.
 *
 * Layers (in order of priority):
 *  1. Column-name regex rules → HIGH confidence
 *  2. Sample-content inspection (text columns only) → MEDIUM confidence
 *  3. LLM fallback (`llmClassifyFn`) for remaining unclassified columns → LOW confidence
 *  4. Hard fallback: UNKNOWN / keep
 *
 * @param schema    - Schema graph from the Introspection Engine
 * @param pool      - Live pg.Pool for sample-content scanning
 * @param llmClassifyFn - Optional async LLM classification function
 */
export async function classifySchema(
  schema: SchemaGraph,
  pool: Pool,
  llmClassifyFn?: LlmClassifyFn
): Promise<ClassificationResult[]> {
  const results: ClassificationResult[] = [];
  const pendingLlm: Array<{ table: string; column: string; dataType: string }> = [];

  for (const table of schema.tables) {
    for (const column of table.columns) {
      // Primary keys are structural identifiers — no PII masking needed
      if (column.isPrimaryKey) {
        results.push({
          table: table.name,
          column: column.name,
          category: 'UNKNOWN',
          confidence: 'NONE',
          strategy: 'keep',
          source: 'fallback',
        });
        continue;
      }

      // ── Layer 1: Column-name regex ─────────────────────────────────────────
      const nameMatch = classifyByName(column.name);
      if (nameMatch) {
        results.push({
          table: table.name,
          column: column.name,
          ...nameMatch,
          confidence: 'HIGH',
          source: 'regex',
        });
        continue;
      }

      // ── Layer 2: Sample-content inspection (text-like columns only) ────────
      const isTextLike = /text|varchar|char|string|bpchar/i.test(column.dataType);
      if (isTextLike) {
        const samples = await fetchSamples(pool, table.name, column.name);
        const contentMatch = classifyByContent(samples);
        if (contentMatch) {
          results.push({
            table: table.name,
            column: column.name,
            ...contentMatch,
            confidence: 'MEDIUM',
            source: 'sample-content',
          });
          continue;
        }
      }

      // ── Layer 3: Queue for LLM fallback ────────────────────────────────────
      pendingLlm.push({ table: table.name, column: column.name, dataType: column.dataType });
    }
  }

  // Batch all LLM-pending columns in one API call
  if (pendingLlm.length > 0) {
    if (llmClassifyFn) {
      const llmInputs = await Promise.all(
        pendingLlm.map(async (col) => ({
          table: col.table,
          column: col.column,
          dataType: col.dataType,
          sampleValues: await fetchSamples(pool, col.table, col.column, 10),
        }))
      );

      try {
        const llmResults = await llmClassifyFn(llmInputs);
        results.push(...llmResults.map((r) => ({ ...r, source: 'llm' as const })));
        return results;
      } catch (err) {
        console.warn('[EnvShield] LLM classification failed, applying hard fallback:', err);
      }
    }

    // Hard fallback: UNKNOWN / keep
    for (const col of pendingLlm) {
      results.push({
        table: col.table,
        column: col.column,
        category: 'UNKNOWN',
        confidence: 'NONE',
        strategy: 'keep',
        source: 'fallback',
      });
    }
  }

  return results;
}
