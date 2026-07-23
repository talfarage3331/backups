import { Transform, type TransformCallback } from 'stream';
import * as crypto from 'crypto';
import type { MaskingStrategy } from '../ai/classifier.js';

export interface MaskingConfig {
  strategies: Record<string, MaskingStrategy>; // Key format: "table_name.column_name"
  forceRedactSet?: Set<string>; // Key format: "table_name.column_name"
  hmacSecret?: string;
}

// Pre-defined pools for fast, low-memory synthetic data generation
const FIRST_NAMES = ['John', 'Jane', 'Alex', 'Emily', 'Michael', 'Sarah', 'David', 'Jessica', 'James', 'Ashley'];
const LAST_NAMES  = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Garcia', 'Rodriguez', 'Wilson'];
const STREETS     = ['Main St', 'Oak Ave', 'Pine Rd', 'Maple Dr', 'Cedar Ln', 'Elm St', 'View Rd', 'Hill St'];
const CITIES      = ['Springfield', 'Franklin', 'Clinton', 'Greenville', 'Bristol', 'Salem', 'Fairview'];

// Pre-computed hex chars lookup — avoids buffer.toString('hex') allocations
const HEX = '0123456789abcdef';

/**
 * Fast djb2 hash — pure bitwise, no crypto overhead.
 * Used for non-security-sensitive anonymization (names, addresses, emails).
 * Deterministic: same input always produces same number.
 */
function djb2(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h & h; // keep 32-bit
  }
  return h >>> 0; // unsigned
}

/** Convert a 32-bit uint to 8-char hex without Buffer allocation */
function toHex8(n: number): string {
  return (
    HEX[(n >>> 28) & 0xf] + HEX[(n >>> 24) & 0xf] +
    HEX[(n >>> 20) & 0xf] + HEX[(n >>> 16) & 0xf] +
    HEX[(n >>> 12) & 0xf] + HEX[(n >>>  8) & 0xf] +
    HEX[(n >>>  4) & 0xf] + HEX[ n         & 0xf]
  );
}

export class StreamMaskingTransformer extends Transform {
  private tableName: string;
  private strategies: Record<string, MaskingStrategy>;
  private forceRedactSet: Set<string>;
  private hmacSecret: string;

  // Bounded HMAC cache — evict oldest when full to prevent unbounded growth
  private readonly HMAC_CACHE_MAX = 50_000;
  private hmacCache = new Map<string, string>();

  constructor(tableName: string, config: MaskingConfig) {
    super({ objectMode: true, highWaterMark: 512 });
    this.tableName = tableName;
    this.strategies = config.strategies;
    this.forceRedactSet = config.forceRedactSet ?? new Set();
    this.hmacSecret = config.hmacSecret ?? 'envshield-default-secret-key';
  }

  _transform(row: any, _encoding: string, callback: TransformCallback): void {
    if (!row || typeof row !== 'object') {
      return callback(null, row);
    }

    try {
      const maskedRow: Record<string, any> = {};
      const keys = Object.keys(row);

      for (let k = 0; k < keys.length; k++) {
        const colName = keys[k];
        const val = row[colName];

        if (val === null || val === undefined) {
          maskedRow[colName] = val;
          continue;
        }

        const fullKey = `${this.tableName}.${colName}`;
        let strategy: MaskingStrategy = 'keep';

        if (this.forceRedactSet.has(fullKey)) {
          strategy = 'redact';
        } else {
          const s = this.strategies[fullKey];
          if (s) strategy = s;
        }

        maskedRow[colName] = strategy === 'keep' ? val : this.maskValue(colName, val, strategy);
      }

      callback(null, maskedRow);
    } catch (err: any) {
      callback(err);
    }
  }

  maskValue(colName: string, val: any, strategy: MaskingStrategy): any {
    switch (strategy) {
      case 'redact':
        return typeof val === 'number' ? 0 : '[REDACTED]';

      case 'hmac-hash': {
        const valStr = String(val);
        const cached = this.hmacCache.get(valStr);
        if (cached) return cached;

        const hash = crypto.createHmac('sha256', this.hmacSecret)
          .update(valStr)
          .digest('hex')
          .substring(0, 16);

        if (this.hmacCache.size >= this.HMAC_CACHE_MAX) {
          this.hmacCache.delete(this.hmacCache.keys().next().value!);
        }
        this.hmacCache.set(valStr, hash);
        return hash;
      }

      case 'anonymize': {
        const valStr = String(val);
        const lowerCol = colName.toLowerCase();

        if (lowerCol.includes('email')) {
          return `user_${toHex8(djb2(valStr))}@masked.com`;
        }

        if (lowerCol.includes('phone') || lowerCol.includes('tel') || lowerCol.includes('mobile')) {
          let tail = '';
          for (let i = valStr.length - 1; i >= 0 && tail.length < 4; i--) {
            const c = valStr.charCodeAt(i);
            if (c >= 48 && c <= 57) tail = valStr[i] + tail;
          }
          return `555-01${tail.padStart(4, '0')}`;
        }

        if (lowerCol.includes('name')) {
          const h = djb2(valStr);
          return `${FIRST_NAMES[h % FIRST_NAMES.length]} ${LAST_NAMES[(h >>> 4) % LAST_NAMES.length]}`;
        }

        if (lowerCol.includes('address') || lowerCol.includes('street')) {
          const h = djb2(valStr);
          return `${(h % 999) + 1} ${STREETS[h % STREETS.length]}, ${CITIES[(h >>> 3) % CITIES.length]}`;
        }

        // Generic fallback: fast djb2 hex, no crypto overhead
        return `anon_${toHex8(djb2(valStr))}`;
      }

      default:
        return val;
    }
  }
}
