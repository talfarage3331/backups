import 'dotenv/config';
import express from 'express';
import { classifyRoute } from './routes/ai-classify.js';
import { rulesRouter } from './routes/rules.js';
import { auditRouter } from './routes/audit.js';

const app = express();
const PORT = process.env['PORT'] ?? 3001;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'envshield-control-plane' });
});

// ─── AI Classification route (Phase 3) ───────────────────────────────────────
app.post('/api/v1/ai/classify', classifyRoute);

// ─── Masking Rules routes (Phase 5) ──────────────────────────────────────────
// GET  /api/v1/rules/fetch?projectId=...   → fetch all rules for a project
// POST /api/v1/rules/update                → upsert a single masking rule
app.use('/api/v1/rules', rulesRouter);

// ─── Audit Log routes (Phase 5) ───────────────────────────────────────────────
// GET  /api/v1/audit/log?projectId=...     → list audit entries for a project
// POST /api/v1/audit/log                   → record a new audit entry (called by CLI)
app.use('/api/v1/audit', auditRouter);

// ─── 404 catch-all ───────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[EnvShield] Control Plane running on http://localhost:${PORT}`);
});

export default app;
