import { Router, Request, Response } from 'express';
import pool from '../db.js';

export const rulesRouter = Router();

// ─── GET /api/v1/rules/fetch?projectId=... ────────────────────────────────────
rulesRouter.get('/fetch', async (req: Request, res: Response) => {
  const { projectId } = req.query;
  if (!projectId || typeof projectId !== 'string') {
    res.status(400).json({ error: 'projectId query param is required.' });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT id, project_id, table_name, column_name, strategy, config_json, updated_at
       FROM masking_rules
       WHERE project_id = $1
       ORDER BY table_name, column_name`,
      [projectId]
    );
    res.json({ rules: result.rows });
  } catch (err) {
    console.error('[rules/fetch] DB error:', err);
    res.status(500).json({ error: 'Failed to fetch masking rules.' });
  }
});

// ─── POST /api/v1/rules/update ────────────────────────────────────────────────
// Body: { projectId, tableName, columnName, strategy, configJson? }
rulesRouter.post('/update', async (req: Request, res: Response) => {
  const { projectId, tableName, columnName, strategy, configJson } = req.body as {
    projectId: string;
    tableName: string;
    columnName: string;
    strategy: string;
    configJson?: Record<string, unknown>;
  };

  if (!projectId || !tableName || !columnName || !strategy) {
    res.status(400).json({ error: 'projectId, tableName, columnName, and strategy are required.' });
    return;
  }

  const VALID_STRATEGIES = ['hash', 'anonymize', 'redact', 'keep'];
  if (!VALID_STRATEGIES.includes(strategy)) {
    res.status(400).json({ error: `Invalid strategy. Must be one of: ${VALID_STRATEGIES.join(', ')}.` });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO masking_rules (project_id, table_name, column_name, strategy, config_json, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
       ON CONFLICT (project_id, table_name, column_name)
       DO UPDATE SET
         strategy    = EXCLUDED.strategy,
         config_json = EXCLUDED.config_json,
         updated_at  = NOW()
       RETURNING *`,
      [projectId, tableName, columnName, strategy, JSON.stringify(configJson ?? {})]
    );
    res.json({ rule: result.rows[0] });
  } catch (err) {
    console.error('[rules/update] DB error:', err);
    res.status(500).json({ error: 'Failed to save masking rule.' });
  }
});
