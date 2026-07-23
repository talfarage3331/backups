export interface ForeignKeyRelation {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

export interface SubsettingConfig {
  rootTable: string;
  subsetPercentage: number; // e.g. 5
  relations: ForeignKeyRelation[];
}

export class DAGSubsettingEngine {
  private relations: ForeignKeyRelation[];
  private rootTable: string;
  private subsetPercentage: number;

  constructor(config: SubsettingConfig) {
    this.relations = config.relations;
    this.rootTable = config.rootTable;
    this.subsetPercentage = config.subsetPercentage;
  }

  /**
   * Identifies foreign key paths and builds a sequence of tables to extract in order.
   * Relational integrity requires parents to be synchronized before or alongside children.
   */
  getExecutionOrder(tables: string[]): string[] {
    // Topologically sort tables based on relations
    const adj = new Map<string, Set<string>>();
    const inDegree = new Map<string, number>();

    for (const t of tables) {
      adj.set(t, new Set());
      inDegree.set(t, 0);
    }

    for (const rel of this.relations) {
      if (adj.has(rel.toTable) && adj.has(rel.fromTable)) {
        // Parent (toTable) must come before Child (fromTable)
        if (!adj.get(rel.toTable)!.has(rel.fromTable)) {
          adj.get(rel.toTable)!.add(rel.fromTable);
          inDegree.set(rel.fromTable, (inDegree.get(rel.fromTable) ?? 0) + 1);
        }
      }
    }

    const queue: string[] = [];
    for (const [t, deg] of inDegree.entries()) {
      if (deg === 0) queue.push(t);
    }

    const order: string[] = [];
    while (queue.length > 0) {
      // Sort to make ordering deterministic
      queue.sort();
      const curr = queue.shift()!;
      order.push(curr);

      const neighbors = adj.get(curr) || new Set();
      for (const next of neighbors) {
        inDegree.set(next, inDegree.get(next)! - 1);
        if (inDegree.get(next) === 0) {
          queue.push(next);
        }
      }
    }

    // Add any remaining tables that were not in relations to the end
    for (const t of tables) {
      if (!order.includes(t)) {
        order.push(t);
      }
    }

    return order;
  }

  /**
   * Generates SQL query filters to subset tables preserving referential integrity.
   * @param tableName - Table to query
   * @param parentIds - Map of table name to allowed ID set for referential checking
   */
  buildSubsetQuery(
    tableName: string,
    parentIds: Record<string, Set<any>>
  ): { sql: string; values: any[] } {
    if (tableName === this.rootTable) {
      // Sample root table randomly or systematically
      return {
        sql: `SELECT * FROM "${tableName}" WHERE drand() <= $1`,
        values: [this.subsetPercentage / 100],
      };
    }

    // Check if this table has any parent relations in the relations list
    const parentRels = this.relations.filter((r) => r.fromTable === tableName);
    if (parentRels.length === 0) {
      // Independent table: apply default sampling
      return {
        sql: `SELECT * FROM "${tableName}" WHERE drand() <= $1`,
        values: [this.subsetPercentage / 100],
      };
    }

    // Build relational join query or IN filter
    const clauses: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    for (const rel of parentRels) {
      const allowedIds = parentIds[rel.toTable];
      if (allowedIds && allowedIds.size > 0) {
        const idArr = Array.from(allowedIds);
        const placeholders = idArr.map((_, i) => `$${paramIdx + i}`).join(',');
        clauses.push(`"${rel.fromColumn}" IN (${placeholders})`);
        values.push(...idArr);
        paramIdx += idArr.length;
      }
    }

    if (clauses.length > 0) {
      return {
        sql: `SELECT * FROM "${tableName}" WHERE ${clauses.join(' OR ')}`,
        values,
      };
    }

    // Fallback if parent IDs are not loaded/present
    return {
      sql: `SELECT * FROM "${tableName}" WHERE drand() <= $1`,
      values: [this.subsetPercentage / 100],
    };
  }
}
