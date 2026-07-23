import Anthropic from '@anthropic-ai/sdk';
import type { RequestHandler } from 'express';
import type { ClassificationResult, PiiCategory, MaskingStrategy } from '@envshield/core';

// ─── Request / response shapes ────────────────────────────────────────────────

interface ColumnInput {
  table: string;
  column: string;
  dataType: string;
  sampleValues: string[];
}

interface ClassifyRequest {
  columns: ColumnInput[];
}

interface ClassifyResponse {
  results: ClassificationResult[];
}

// ─── LLM client ───────────────────────────────────────────────────────────────

const anthropic = new Anthropic({
  apiKey: process.env['ANTHROPIC_API_KEY'],
});

const SYSTEM_PROMPT = `You are a PII (Personally Identifiable Information) risk classifier for database columns.
Your task is to analyze database column metadata and sample values to determine if they contain PII.

You MUST respond ONLY with a valid JSON array. No explanations, no markdown, no code fences — just the raw JSON array.

Each element in the array must have exactly these fields:
- "table": string (the table name, copied from input)
- "column": string (the column name, copied from input)
- "category": one of: "EMAIL" | "PHONE" | "SSN" | "CREDIT_CARD" | "IP_ADDRESS" | "PASSWORD" | "NAME" | "ADDRESS" | "DOB" | "UNKNOWN"
- "confidence": one of: "HIGH" | "MEDIUM" | "LOW" | "NONE"
- "strategy": one of: "hmac-hash" | "anonymize" | "redact" | "keep"

Strategy guidelines:
- EMAIL → "hmac-hash" (preserves cross-table referential integrity)
- PHONE, NAME, ADDRESS → "anonymize" (replace with synthetic data)
- SSN, CREDIT_CARD, IP_ADDRESS, PASSWORD, DOB → "redact" (replace with [REDACTED])
- UNKNOWN → "keep" (no masking applied)

When in doubt, prefer a more conservative strategy (redact > anonymize > hmac-hash > keep).`;

// ─── Route handler ────────────────────────────────────────────────────────────

export const classifyRoute: RequestHandler<
  Record<string, never>,
  ClassifyResponse | { error: string },
  ClassifyRequest
> = async (req, res) => {
  const { columns } = req.body;

  if (!Array.isArray(columns) || columns.length === 0) {
    res.status(400).json({ error: 'Request body must contain a non-empty "columns" array.' });
    return;
  }

  if (columns.length > 100) {
    res.status(400).json({ error: 'Maximum 100 columns per request.' });
    return;
  }

  // Build the user message with a structured JSON payload for the LLM
  const userMessage = JSON.stringify(
    columns.map((col) => ({
      table: col.table,
      column: col.column,
      dataType: col.dataType,
      sampleValues: col.sampleValues.slice(0, 10), // cap to 10 samples per column
    })),
    null,
    2
  );

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Classify the following database columns for PII risk:\n\n${userMessage}`,
        },
      ],
    });

    // Extract text from the response
    const rawText = message.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('');

    // Parse the JSON array — strip any accidental markdown fences
    const cleaned = rawText.replace(/```(?:json)?/g, '').trim();
    const parsed = JSON.parse(cleaned) as Array<{
      table: string;
      column: string;
      category: PiiCategory;
      confidence: ClassificationResult['confidence'];
      strategy: MaskingStrategy;
    }>;

    const results: ClassificationResult[] = parsed.map((item) => ({
      table: item.table,
      column: item.column,
      category: item.category,
      confidence: item.confidence,
      strategy: item.strategy,
      source: 'llm' as const,
    }));

    res.json({ results });
  } catch (err) {
    console.error('[EnvShield] LLM classification error:', err);
    res.status(502).json({ error: 'LLM classification service unavailable. Please try again.' });
  }
};
