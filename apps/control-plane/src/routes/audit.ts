import { Router, Request, Response } from 'express';
import pool from '../db.js';

export const auditRouter = Router();

// ─── GET /api/v1/audit/log?projectId=...&limit=50 ────────────────────────────
auditRouter.get('/log', async (req: Request, res: Response) => {
  const { projectId, limit } = req.query;
  if (!projectId || typeof projectId !== 'string') {
    res.status(400).json({ error: 'projectId query param is required.' });
    return;
  }

  const maxRows = Math.min(parseInt(String(limit ?? '50'), 10) || 50, 200);

  try {
    const result = await pool.query(
      `SELECT id, project_id, environment_name, rows_processed, status, execution_hash, created_at
       FROM audit_logs
       WHERE project_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [projectId, maxRows]
    );
    res.json({ logs: result.rows, total: result.rowCount });
  } catch (err) {
    console.error('[audit/log GET] DB error:', err);
    res.status(500).json({ error: 'Failed to fetch audit logs.' });
  }
});

// ─── POST /api/v1/audit/log ───────────────────────────────────────────────────
// Called by CLI at the end of each sync run to record results.
// Body: { projectId, environmentName, rowsProcessed, status, executionHash }
auditRouter.post('/log', async (req: Request, res: Response) => {
  const { projectId, environmentName, rowsProcessed, status, executionHash } = req.body as {
    projectId: string;
    environmentName: string;
    rowsProcessed: number;
    status: string;
    executionHash: string;
  };

  if (!projectId || !environmentName || rowsProcessed == null || !status || !executionHash) {
    res.status(400).json({ error: 'Missing required fields: projectId, environmentName, rowsProcessed, status, executionHash.' });
    return;
  }

  const VALID_STATUSES = ['success', 'failed'];
  if (!VALID_STATUSES.includes(status)) {
    res.status(400).json({ error: `Invalid status. Must be 'success' or 'failed'.` });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO audit_logs
         (project_id, environment_name, rows_processed, status, execution_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [projectId, environmentName, rowsProcessed, status, executionHash]
    );
    res.status(201).json({ log: result.rows[0] });
  } catch (err) {
    console.error('[audit/log POST] DB error:', err);
    res.status(500).json({ error: 'Failed to record audit log.' });
  }
});
