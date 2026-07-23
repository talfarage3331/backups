# SPEC.md: EnvShield — Compliance-Driven Environment Sync & Auto-Masking
> **Version:** 1.0.0  
> **Status:** Approved for Implementation  
> **Architecture Model:** Zero-Data Retention (ZDR) / Developer-First  

---

## 1. Executive Summary & Product Vision

### 1.1 Product Definition
* **Product Name:** EnvShield (Temporary Name: SafeSync)
* **One-Liner:** A developer-first platform for automated, compliance-driven environment synchronization, real-time data masking, and smart subsetting running directly within CI/CD pipelines under a Zero-Trust architecture.
* **Value Proposition:** Empowers engineering teams to instantly create lightweight, 100% compliant, and isolated development and testing environments (Ephemeral DBs) directly from Pull Requests without sensitive data ever leaving customer infrastructure (Zero Data Retention).

### 1.2 Core Problem Statement
1. **PII Exposure & Compliance Risk:** Companies frequently copy production databases to non-production environments (staging, local dev), directly violating data privacy regulations (GDPR, SOC2, HIPAA) and creating massive data leak vectors.
2. **Schema Drift & Maintenance Overhead:** Manual data masking scripts (SQL/Python) break continuously whenever developers run schema migrations or add new columns.
3. **Database Bloat & Slow Onboarding:** Multi-hundred gigabyte databases cannot be spun up quickly on local laptops or temporary CI/CD instances.

### 1.3 The EnvShield Solution
A lightweight, fast, developer-first alternative to enterprise platforms like Tonic.ai and Delphix:
* **Zero-Trust Execution:** Data transformations happen locally inside the customer’s runner/container. No sensitive data reaches EnvShield servers.
* **Smart Subsetting:** Graph-based extraction of 1%–5% of production data while maintaining 100% referential integrity.
* **Self-Healing Schema Drift:** Automatic detection and fail-safe masking of newly added columns during code migrations.
* **Ephemeral DB Previews:** Automatic provisioning of small, masked preview databases for every GitHub Pull Request.

---

## 2. Target Audience & ICP

### 2.1 Ideal Customer Profile (ICP)
* **Target Companies:** High-growth startups and B2B SaaS companies (10–150 developers) handling sensitive user, financial, or healthcare data.
* **Buyers / Decision Makers:** VP of Engineering, Tech Leads, DevSecOps Engineers, CISO.
* **End Users:** Full-Stack Engineers, Backend Developers, DevOps Engineers.

### 2.2 Core Use Cases
1. **Automated PR Preview DBs:** A developer opens a GitHub PR -> EnvShield spins up an isolated, masked PostgreSQL database populated with 5% of real-world structured data.
2. **Local Machine Pull:** Developers run `envshield pull` to receive a lightweight, masked local Docker/Postgres container for offline development.
3. **SOC2 / GDPR Audits:** Security officers generate cryptographic audit certificates verifying zero PII exposure in non-production environments.

---

## 3. System Architecture & Core Engines

### 3.1 Zero-Data Retention (ZDR) Architecture

* **Control Plane (EnvShield Cloud):** Stores rule definitions, anonymization policies, schema metadata, run histories, and the web management dashboard.
* **Data Plane (Customer Local Execution):** The CLI/Engine executing inside the customer runner. Reads data, streams transformations in-memory, and writes to target databases.

### 3.2 Core Technological Engines

#### 1. Introspection Engine
* Connects to source databases (PostgreSQL/MySQL) to retrieve schema metadata: tables, columns, data types, indexes, primary keys, and foreign keys.
* Generates a clean JSON structural schema without capturing underlying rows.

#### 2. Smart Subsetting Engine (DAG-Based)
* Constructs a Directed Acyclic Graph (DAG) of database relationships.
* Samples X% (e.g., 5%) from a designated root table (e.g., `users`) and recursively traverses relationships to extract matching child records (`orders`, `payments`, `logs`).
* Ensures zero orphaned rows while scaling a 500GB production database down to 2GB in seconds.

#### 3. In-Memory Masking Engine
* High-performance stream-based data transformer:
  * **Deterministic Masking (HMAC Hashing):** Hashes identifiers consistently across tables (e.g., `john@gmail.com` always maps to `user_a8f9@masked.com`) to preserve cross-table relational integrity.
  * **Synthetic Data Generation:** Replaces real names, phone numbers, and addresses with realistic synthetic data powered by Faker utilities.
  * **Redaction & Nullification:** Blanks or redacts high-risk fields (`[REDACTED]`).

#### 4. AI PII Detection & Schema Drift Engine
* **Hybrid Scanner:** Combines fast regex/heuristics with light LLM fallback.
* **Auto-Classification:** Detects high-risk categories (Email, Phone, Credit Cards, IP Addresses, Passwords, SSN).
* **Self-Healing Fail-Safe:** If an unclassified column is added in a migration, EnvShield redacts/hashes it by default until reviewed.

---

## 4. UI/UX Specification

### 4.1 Design System
* **Theme:** Dark mode primary (Vercel / Linear / Supabase aesthetic).
* **Palette:**
  * Background: `#090D16` / `#0F172A`
  * Panels / Cards: `#1E293B`
  * Accent Primary: Indigo (`#6366F1`)
  * Success / Compliant: Emerald (`#10B981`)
  * Warning / PII Alert: Amber (`#F59E0B`)
* **Typography:** Inter (Primary text) + JetBrains Mono (Code/SQL/Identifiers).

### 4.2 Primary Dashboard Views

#### View 1: Schema Explorer & Masking Rule Builder
* **Header Bar:** Search filter (`All Tables`, `PII Detected`, `Unconfigured Rules`).
* **Interactive Table:**
  * Column 1: `Table & Column Name` (e.g., `users.email`).
  * Column 2: `PII Badge` (e.g., `[HIGH RISK - EMAIL]`).
  * Column 3: `Strategy Selector` Dropdown (`Anonymize`, `HMAC Hash`, `Redact`, `Keep Original`).
  * Column 4: `Live Data Preview` Side-by-Side: `john.doe@gmail.com` ➔ `usr_a8f92@masked.com`.

#### View 2: Ephemeral Environments Monitor
* Live view of all active Pull Requests:
  * `PR #142: feat/add-billing-flow`
  * Status Badge: `[ACTIVE - NEON BRANCH]`
  * DB Size: `140 MB (5% Sample)`
  * Actions: `Copy Connection String`, `Teardown Now`.

#### View 3: Compliance & Audit Reports
* Visual chart tracking masked records over time.
* Button: **"Export SOC2 Compliance Certificate (PDF)"**.
* Cryptographically signed audit log table.

---

## 5. Control Plane Data Models & API Specification

### 5.1 Database Schema (SQL DDL)
```sql
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    api_key_hash VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE masking_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    table_name VARCHAR(255) NOT NULL,
    column_name VARCHAR(255) NOT NULL,
    strategy VARCHAR(50) NOT NULL, -- 'hash', 'anonymize', 'redact', 'keep'
    config_json JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, table_name, column_name)
);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    environment_name VARCHAR(100) NOT NULL,
    rows_processed BIGINT NOT NULL,
    status VARCHAR(50) NOT NULL, -- 'success', 'failed'
    execution_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

5.2 API Routes
POST /api/v1/auth/verify-key: Authenticates CLI execution.

POST /api/v1/schema/push: Uploads updated schema metadata from CLI.

GET /api/v1/rules/fetch: Retrieves active project masking rules for CLI runs.

POST /api/v1/audit/log: Records run results and execution hashes.

6. Implementation Plan (Step-by-Step Task Checklist)
This section serves as the sequential instruction set for AI coding agents and engineers.

Phase 1: Project Setup & Monorepo Configuration
[ ] Task 1.1: Initialize a pnpm workspace monorepo with Turborepo containing:

packages/cli (Node.js/TypeScript CLI Engine)

packages/core (Subsetting, Introspection, Masking libraries)

apps/web (React + Vite + Tailwind + Shadcn UI)

apps/control-plane (Backend API / Supabase Handlers)

[ ] Task 1.2: Deploy the Control Plane database migrations using the SQL DDL in Section 5.1.

Phase 2: Core CLI Engine & Data Streaming
[ ] Task 2.1: Implement the Introspection module in packages/core to query information_schema and extract table/foreign key graphs.

[ ] Task 2.2: Build the DAG Subsetting Engine to traverse foreign key relationships starting from a root table and pull a consistent X% sample.

[ ] Task 2.3: Build the In-Memory Masking Engine using Node.js Streams, supporting HMAC-SHA256 hashing, @faker-js/faker synthetic generation, and redaction.

Phase 3: AI PII Detection & Schema Drift
[ ] Task 3.1: Implement Regex/Heuristic pattern matching for common PII column names and sample data content.

[ ] Task 3.2: Integrate a lightweight LLM API route (Claude 3.5 Haiku or gpt-4o-mini) to classify ambiguous column names.

[ ] Task 3.3: Implement a fail-safe schema drift mechanism that defaults unconfigured new columns to redact during runtime.

Phase 4: CI/CD & Ephemeral DB Integrations
[ ] Task 4.1: Package the CLI into a reusable GitHub Action (action.yml).

[ ] Task 4.2: Integrate with Neon DB API to create isolated PostgreSQL branches on pull_request events, inject connection strings, and teardown branches on PR closure.

Phase 5: Web Dashboard Development
[ ] Task 5.1: Set up the React Dark Mode UI Shell using Vite, Tailwind CSS, and Shadcn UI components.

[ ] Task 5.2: Develop the Schema Explorer view featuring interactive rule selection and live side-by-side data transformation previews.

[ ] Task 5.3: Build the Ephemeral Environments monitoring table and the SOC2 Audit Trail generator.

Phase 6: QA, Hardening & Security Verification
[ ] Task 6.1: Write automated integration tests (Vitest/Jest) verifying zero PII leakage after full sync cycles.

[ ] Task 6.2: Benchmark CLI performance to ensure processing rates exceeding 100,000 records/sec under <512MB RAM usage.

[ ] Task 6.3: Publish the CLI package to NPM and release the GitHub Action to the GitHub Marketplace.
