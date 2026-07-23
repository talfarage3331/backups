# 🛡️ EnvShield — Compliance-Driven Environment Sync & Auto-Masking

> **Zero-Trust · Zero-Data-Retention · Developer-First**

[![CI](https://github.com/your-org/envshield/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/envshield/actions/workflows/ci.yml)
[![npm @envshield/cli](https://img.shields.io/npm/v/@envshield/cli?label=%40envshield%2Fcli)](https://www.npmjs.com/package/@envshield/cli)
[![npm @envshield/core](https://img.shields.io/npm/v/@envshield/core?label=%40envshield%2Fcore)](https://www.npmjs.com/package/@envshield/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

EnvShield is a **developer-first platform** for automated, compliance-driven environment synchronization. It creates lightweight, 100% compliant development and testing databases by intelligently subsetting and masking production data — all without sensitive data ever leaving your own infrastructure.

---

## Table of Contents

- [Why EnvShield?](#why-envshield)
- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
  - [Installation](#installation)
  - [Scan a Database](#scan-a-database)
  - [Sync a Masked Subset](#sync-a-masked-subset)
- [GitHub Actions Integration](#github-actions-integration)
  - [Ephemeral PR Preview Databases](#ephemeral-pr-preview-databases)
  - [Standard Sync on Push](#standard-sync-on-push)
- [Web Dashboard](#web-dashboard)
- [Control Plane Setup](#control-plane-setup)
  - [Environment Variables](#environment-variables)
  - [Running Migrations](#running-migrations)
- [Monorepo Structure](#monorepo-structure)
- [Development](#development)
- [Configuration Reference](#configuration-reference)
- [Compliance & Security](#compliance--security)
- [Troubleshooting](#troubleshooting)

---

## Why EnvShield?

| Problem | EnvShield Solution |
|---|---|
| 🚨 PII leaks into staging / local dev DBs | In-memory masking — data is transformed before it ever leaves your runner |
| 📉 Schema migrations break masking scripts | Self-healing drift detection auto-redacts new unclassified columns |
| 🐘 500 GB production DB on a laptop | Smart DAG-based subsetting extracts 1–5% with 100% referential integrity |
| ⏳ Hours to spin up a new dev environment | `envshield sync` — seconds, not hours |
| 📋 SOC2/GDPR audit prep | Cryptographically signed audit certificates with every sync run |

---

## How It Works

```
Production DB ──► [EnvShield CLI — runs inside YOUR runner/laptop]
                        │
                        ├─ 1. Introspect schema (zero data rows captured)
                        ├─ 2. DAG subsetting: pull 5% of users + linked orders/payments
                        ├─ 3. In-memory masking: hash emails, redact passwords, anonymize names
                        ├─ 4. Drift guard: auto-redact any new unclassified columns
                        │
                        ▼
              Target DB / Neon Ephemeral Branch
                        │
                        ▼
              EnvShield Control Plane (metadata only — NO raw data)
                  ├─ Masking rule policies
                  ├─ Audit logs & execution hashes
                  └─ Web Dashboard
```

**Zero-Data Retention:** The Control Plane never sees actual database rows. Only schema metadata, masking rules, and audit hashes are stored.

---

## Architecture

This project is a **Turborepo pnpm monorepo** with four packages:

| Package | Description |
|---|---|
| `packages/core` | Core engines: Introspection, DAG Subsetting, Stream Masking, AI PII Classifier, Schema Drift Guard |
| `packages/cli` | CLI (`envshield scan`, `envshield sync`) + GitHub Action runner |
| `apps/control-plane` | Express REST API — manages masking rules, audit logs, AI classification |
| `apps/web` | React + Vite dashboard — Schema Explorer, Environments Monitor, SOC2 Audit |

---

## Quick Start

### Installation

```bash
# Install the CLI globally
npm install -g @envshield/cli

# Verify installation
envshield --version
```

### Scan a Database

Run a PII risk scan to introspect your schema and detect sensitive columns:

```bash
envshield scan \
  --source "postgresql://user:password@localhost:5432/production_db"
```

**Example output:**

```
────────────────────────────────────────────────────────────────────────────────
  EnvShield PII Scan Report
────────────────────────────────────────────────────────────────────────────────
  TABLE.COLUMN                             CATEGORY       STRATEGY     SOURCE
────────────────────────────────────────────────────────────────────────────────
  ⚠ users.email                           EMAIL          hmac-hash    regex
  ⚠ users.password                        PASSWORD       redact       regex
  ⚠ users.phone                           PHONE          anonymize    regex
  ⚠ orders.credit_card                    CREDIT_CARD    redact       regex
  ⚠ users.ssn                             SSN            redact       llm
    users.id                              UNKNOWN        keep         regex
    orders.amount                         UNKNOWN        keep         regex
────────────────────────────────────────────────────────────────────────────────
  Total: 7 columns | PII detected: 5 | Unclassified: 2
────────────────────────────────────────────────────────────────────────────────
```

> **Tip:** Use `--control-plane <url>` to connect to your EnvShield Control Plane for LLM-assisted classification of ambiguous columns.

### Sync a Masked Subset

Copy 5% of your production database into a dev/staging target, with full masking applied:

```bash
envshield sync \
  --source "postgresql://user:pass@prod-host:5432/production_db" \
  --target "postgresql://user:pass@dev-host:5432/dev_db" \
  --subset 5
```

**What happens:**
1. Introspects live schema and fetches masking rules from Control Plane
2. Detects any new columns added since last sync (schema drift) — auto-redacts them
3. Uses DAG subsetting to extract 5% of `users` table + all linked child records
4. Streams rows through the in-memory masking transformer
5. Writes masked rows to the target database
6. Logs the run with an execution hash to the audit trail

---

## GitHub Actions Integration

### Ephemeral PR Preview Databases

Automatically spin up a masked, isolated PostgreSQL database for every Pull Request using [Neon DB](https://neon.tech) branching.

Add this to your workflow file (`.github/workflows/preview.yml`):

```yaml
name: PR Preview Database

on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

jobs:
  ephemeral-db:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: EnvShield — Ephemeral DB
        uses: your-org/envshield@v1
        with:
          source-db-url:    ${{ secrets.SOURCE_DB_URL }}
          neon-api-key:     ${{ secrets.NEON_API_KEY }}
          neon-project-id:  ${{ secrets.NEON_PROJECT_ID }}
          github-token:     ${{ secrets.GITHUB_TOKEN }}
          subset-percentage: '5'
```

**What happens automatically:**

| PR Event | Action |
|---|---|
| `opened` / `synchronize` | Creates a Neon branch `pr-{number}`, runs masked sync, posts connection string as PR comment |
| `closed` | Deletes the Neon branch and notifies on PR |

**Required secrets:**

| Secret | Where to get it |
|---|---|
| `SOURCE_DB_URL` | Your production PostgreSQL connection string |
| `NEON_API_KEY` | [Neon Console](https://console.neon.tech) → Account → API Keys |
| `NEON_PROJECT_ID` | [Neon Console](https://console.neon.tech) → Your Project → Settings |

### Standard Sync on Push

To sync a fixed target database on every push to `main`:

```yaml
name: Sync Staging DB

on:
  push:
    branches: [main]

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: EnvShield Sync
        uses: your-org/envshield@v1
        with:
          source-db-url:    ${{ secrets.SOURCE_DB_URL }}
          target-db-url:    ${{ secrets.STAGING_DB_URL }}
          subset-percentage: '10'
          envshield-api-key: ${{ secrets.ENVSHIELD_API_KEY }}
          control-plane-url: ${{ secrets.CONTROL_PLANE_URL }}
```

### All Action Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `source-db-url` | ✅ Yes | — | PostgreSQL source connection URL |
| `target-db-url` | No | — | Target DB URL (ignored if using Neon) |
| `neon-api-key` | No | — | Neon API key for ephemeral DB mode |
| `neon-project-id` | No | — | Neon Project ID |
| `github-token` | No | — | GitHub token to post PR comments |
| `neon-parent-branch` | No | `main` | Neon branch to fork from |
| `subset-percentage` | No | `5` | Percentage of rows to sample |
| `envshield-api-key` | No | — | EnvShield project API key |
| `control-plane-url` | No | `http://localhost:3001` | Control Plane base URL |
| `show-plain-credentials` | No | `false` | Include plain password in PR comment |

---

## Web Dashboard

The EnvShield dashboard (`apps/web`) provides three core views:

### 1. Schema Explorer & Masking Rule Builder
- Searchable table of all columns with auto-detected PII badges
- Strategy selector per column: `Anonymize`, `HMAC Hash`, `Redact`, `Keep Original`
- Live side-by-side preview: `john@gmail.com` → `user_a8f9@masked.com`

### 2. Ephemeral Environments Monitor
- Live view of all active PR preview databases
- Quick actions: `Copy Connection String`, `Teardown Now`
- Branch status, DB size, and sample percentage

### 3. Compliance & Audit Reports
- Chart of masked records over time
- Cryptographically signed audit log table
- **Export SOC2 Compliance Certificate (PDF)** button

**Run the dashboard locally:**

```bash
pnpm --filter web dev
# Opens at http://localhost:5173
```

---

## Control Plane Setup

The Control Plane (`apps/control-plane`) is an Express API that stores masking rules, audit logs, and provides the AI classification endpoint.

### Environment Variables

Copy `.env.example` to `.env` in `apps/control-plane/`:

```bash
cp apps/control-plane/.env.example apps/control-plane/.env
```

Then fill in:

```env
# PostgreSQL / Supabase connection string
DATABASE_URL=postgresql://user:password@host:5432/envshield_control

# Optional: AI classification (Claude or OpenAI)
ANTHROPIC_API_KEY=sk-ant-...
# or
OPENAI_API_KEY=sk-...

NODE_ENV=production
PORT=3001
```

### Running Migrations

Apply the database schema (creates `projects`, `masking_rules`, `audit_logs` tables):

```bash
pnpm --filter control-plane migrate
```

### Running the Control Plane

```bash
# Development (with hot reload)
pnpm --filter control-plane dev

# Production
pnpm --filter control-plane build
pnpm --filter control-plane start
```

### API Routes

| Method | Route | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/api/v1/ai/classify` | Classify ambiguous column names with LLM |
| `GET` | `/api/v1/rules/fetch` | Fetch masking rules for a project |
| `POST` | `/api/v1/rules/update` | Save/update a masking rule |
| `GET` | `/api/v1/audit/log` | List audit log entries for a project |
| `POST` | `/api/v1/audit/log` | Record a new audit/drift event (called by CLI) |

---

## Monorepo Structure

```
envshield/
├── packages/
│   ├── core/                       # @envshield/core
│   │   └── src/
│   │       ├── ai/
│   │       │   ├── classifier.ts   # Regex + LLM PII classifier
│   │       │   └── drift-guard.ts  # Schema drift detection engine
│   │       ├── masking/
│   │       │   └── transformer.ts  # Stream masking (HMAC, Redact, Anonymize)
│   │       ├── subsetting/
│   │       │   └── dag.ts          # DAG-based relational subsetting
│   │       └── index.ts            # Public API exports
│   └── cli/                        # @envshield/cli
│       └── src/
│           ├── index.ts            # CLI commands: scan, sync
│           └── action-runner.ts    # GitHub Action entry point
├── apps/
│   ├── control-plane/              # Express REST API
│   │   ├── migrations/
│   │   │   └── 001_init.sql        # DDL: projects, masking_rules, audit_logs
│   │   └── src/
│   │       ├── routes/
│   │       │   ├── ai-classify.ts
│   │       │   ├── rules.ts
│   │       │   └── audit.ts
│   │       └── index.ts
│   └── web/                        # React + Vite Dashboard
│       └── src/
│           ├── pages/
│           │   ├── Dashboard.tsx
│           │   ├── SchemaExplorer.tsx
│           │   ├── Environments.tsx
│           │   ├── Pipelines.tsx
│           │   ├── Settings.tsx
│           │   └── Auth.tsx
│           └── services/
├── action.yml                      # Reusable GitHub Action definition
├── .github/
│   └── workflows/
│       ├── ci.yml                  # CI: lint, build, test on every PR
│       └── release.yml             # Release: publish to NPM on version tags
└── plan.md                         # Execution blueprint & task tracker
```

---

## Development

### Prerequisites

- **Node.js** 20+
- **pnpm** 10+ (`npm install -g pnpm`)

### Setup

```bash
# Clone the repo
git clone https://github.com/your-org/envshield.git
cd envshield

# Install all workspace dependencies
pnpm install

# Build all packages
pnpm build

# Run all tests
pnpm test

# Run the linter
pnpm lint
```

### Running Everything Locally

```bash
# Terminal 1: Start the Control Plane API
pnpm --filter control-plane dev

# Terminal 2: Start the Web Dashboard
pnpm --filter web dev

# Terminal 3: Use the CLI
node packages/cli/dist/index.js scan --source "postgresql://..."
```

### Publishing a Release

1. Bump version in `packages/core/package.json` and `packages/cli/package.json`
2. Commit: `git commit -m "chore: release v1.0.0"`
3. Tag: `git tag v1.0.0`
4. Push: `git push origin main --tags`

The `release.yml` workflow automatically runs the quality gate, publishes both packages to NPM, and creates a GitHub Release.

---

## Configuration Reference

### CLI Flags

#### `envshield scan`

```
--source <url>           PostgreSQL connection URL (required)
--control-plane <url>    Control Plane URL for LLM classification (default: http://localhost:3001)
```

#### `envshield sync`

```
--source <url>           PostgreSQL source connection URL (required)
--target <url>           PostgreSQL target connection URL (required)
--subset <percentage>    Rows to sample, e.g. 5 for 5% (default: 5)
--api-key <key>          EnvShield project API key
--control-plane <url>    Control Plane URL (default: http://localhost:3001)
```

### Masking Strategies

| Strategy | Description | Example |
|---|---|---|
| `hmac-hash` | Deterministic HMAC-SHA256 hash | `john@gmail.com` → `a8f92c4d1e...` |
| `anonymize` | Realistic synthetic replacement | `John Smith` → `Emily Johnson` |
| `redact` | Blanks the value | `S3cr3t!` → `[REDACTED]` |
| `keep` | Pass through unchanged | `42` → `42` |

---

## Compliance & Security

### Zero-Data Retention

EnvShield is designed around **Zero-Data Retention (ZDR)**:
- All masking and subsetting happens **inside your CI runner or laptop**
- The Control Plane only stores schema metadata, rule definitions, and execution hashes
- **No actual database rows ever leave your infrastructure**

### Fail-Safe Schema Drift

If a database migration adds a new column that has no masking rule configured:
1. EnvShield detects the new column by diffing live schema against stored rules
2. Automatically applies `redact` (`[REDACTED]`) as a fail-safe
3. Emits a warning to the Control Plane audit log for review

### Audit Trail

Every `envshield sync` run produces an immutable audit log entry containing:
- Timestamp and environment name
- Number of rows processed per table
- Run status (`success` / `failed`)
- Execution hash (SHA-256 of config + schema fingerprint)

These entries can be exported as a **SOC2 Compliance Certificate** from the web dashboard.

---

## Troubleshooting

### `Control Plane unreachable. Treating all columns as unclassified.`

The CLI could not connect to the Control Plane API. This is non-fatal — the CLI will proceed without stored masking rules and will classify all columns using built-in regex heuristics only.

**Fix:** Start the Control Plane with `pnpm --filter control-plane dev`, or set `--control-plane <url>` to point to your deployed instance.

### `ERROR: permission denied for table "users"`

The source database user lacks `SELECT` privileges.

**Fix:** Grant read access: `GRANT SELECT ON ALL TABLES IN SCHEMA public TO <your_user>;`

### Neon branch creation fails with 404

The `neon-project-id` is incorrect.

**Fix:** Copy the Project ID from your [Neon Console](https://console.neon.tech) → Project → Settings page.

### Large tables timing out during sync

The subset percentage may be too large for tables with millions of rows.

**Fix:** Lower `--subset` to `1` or `2`. For a 500M row table, `--subset 1` still gives you 5M rows — more than enough for development.

---

## License

MIT © EnvShield Contributors
