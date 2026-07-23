# PLAN.md: EnvShield Execution Blueprint
> **Project:** EnvShield (Compliance-Driven Environment Sync & Auto-Masking)  
> **Target:** AI Coding Agents & Engineering Teams  
> **Status:** Ready for Execution  

---

## Task Execution Guidelines
* **Strict Monorepo Isolation:** Always ensure changes in `packages/core` or `packages/cli` do not introduce breaking changes to `apps/web` or `apps/control-plane`.
* **Zero-Trust Rule:** Never write logic that transmits actual row data/PII outside customer infrastructure or into Control Plane databases.
* **Testing Mandatory:** Every engine built in `packages/core` must be accompanied by unit tests in Vitest verifying transformation correctness.

---

## Phase 1: Workspace Setup & Infrastructure (Tasks 1.1 - 1.3)

### Task 1.1: Initialize Monorepo Architecture
* **Goal:** Set up a Turborepo-driven pnpm monorepo with proper TypeScript and linting configs.
* **Action Steps:**
  1. Initialize root directory with `pnpm init` and create `pnpm-workspace.yaml` containing:
     * `packages/core`
     * `packages/cli`
     * `apps/web`
     * `apps/control-plane`
  2. Add `turbo.json` with pipeline scripts (`build`, `dev`, `lint`, `test`).
  3. Set up root `tsconfig.json` with strict type checking enabled.

### Task 1.2: Control Plane Database Schema Migration
* **Goal:** Provision the Control Plane database tables for metadata and rule storage.
* **Action Steps:**
  1. Create SQL migration scripts in `apps/control-plane/migrations/001_init.sql` for:
     * `projects` (`id`, `name`, `api_key_hash`, `created_at`)
     * `masking_rules` (`id`, `project_id`, `table_name`, `column_name`, `strategy`, `config_json`, `updated_at`)
     * `audit_logs` (`id`, `project_id`, `environment_name`, `rows_processed`, `status`, `execution_hash`, `created_at`)
  2. Implement database connection pooling using Supabase/PostgreSQL client SDK.

### Task 1.3: Control Plane Authentication API
* **Goal:** Implement API endpoints to verify CLI execution keys.
* **Action Steps:**
  1. Implement `POST /api/v1/auth/verify-key` endpoint that hashes incoming CLI keys and validates against `projects.api_key_hash`.
  2. Implement `GET /api/v1/rules/fetch` endpoint returning active JSON policies for a project.

---

## Phase 2: Core Data Engine Development (Tasks 2.1 - 2.4)

### Task 2.1: Introspection Engine (`packages/core`)
* **Goal:** Extract database structure without fetching actual data rows.
* **Action Steps:**
  1. Write Postgres introspection queries against `information_schema.tables`, `information_schema.columns`, and `information_schema.key_column_usage`.
  2. Construct a normalized JSON schema graph object containing tables, columns, data types, primary keys, and foreign key references.

### Task 2.2: Directed Acyclic Graph (DAG) Subsetting Engine
* **Goal:** Extract a consistent 1%–5% subset of relational data without orphaned rows.
* **Action Steps:**
  1. Build a graph traversal algorithm in `packages/core/src/subsetting/dag.ts`.
  2. Accept a designated root table (e.g., `users`), apply percentage sampling, and recursively pull linked records from child/parent tables using `IN (...)` batch queries.
  3. Validate that referential integrity is 100% preserved in output datasets.

### Task 2.3: In-Memory Stream Masking Engine
* **Goal:** Mask data in RAM streams before writing to target databases.
* **Action Steps:**
  1. Create a stream transformer (`packages/core/src/masking/transformer.ts`).
  2. Implement **HMAC-SHA256 Deterministic Hashing** for identifiers and emails to ensure consistent replacements across tables.
  3. Integrate `@faker-js/faker` to replace names, phone numbers, and addresses with realistic synthetic data.
  4. Implement `Redact` strategy replacing values with `[REDACTED]`.

### Task 2.4: Core CLI Wrapper (`packages/cli`)
* **Goal:** Build the CLI command interface using Commander.js.
* **Action Steps:**
  1. Create CLI command `envshield scan` to run introspection and output PII warnings.
  2. Create CLI command `envshield sync --source <URL> --target <URL> --subset <N%>` to trigger the streaming subsetting + masking pipeline.

---

## Phase 3: AI PII Detection & Schema Drift (Tasks 3.1 - 3.3)

### Task 3.1: Regex & Heuristics PII Classifier
* **Goal:** Instantly identify high-risk columns via names and patterns.
* **Action Steps:**
  1. Implement regex matchers in `packages/core/src/ai/classifier.ts` targeting common field names (`email`, `phone`, `ssn`, `card_number`, `ip_address`).
  2. Add sample-content inspection scanning up to 100 sample rows for pattern validation.

### Task 3.2: LLM Fallback Classification Route
* **Goal:** Classify ambiguous or custom column names using a fast LLM.
* **Action Steps:**
  1. Create endpoint `POST /api/v1/ai/classify` in `apps/control-plane`.
  2. Integrate Claude 3.5 Haiku / GPT-4o-mini API with a strict JSON schema prompt accepting unknown column names and returning PII risk levels + recommended strategy.

### Task 3.3: Self-Healing Schema Drift Mechanism
* **Goal:** Provide fail-safe protection when database migrations add new unclassified columns.
* **Action Steps:**
  1. In the CLI execution pipeline, compare live database schema against stored rules.
  2. If a new, unconfigured column is detected, automatically apply a fail-safe `Redact` rule during sync and emit a warning to the Control Plane.

---

## Phase 4: CI/CD & Ephemeral DB Integrations (Tasks 4.1 - 4.2)

### Task 4.1: Reusable GitHub Action Packaging
* **Goal:** Create a turnkey GitHub Action wrapper for EnvShield CLI.
* **Action Steps:**
  1. Create `action.yml` in project root configured to run `envshield sync` inside GitHub Actions runners.
  2. Expose action inputs: `envshield-api-key`, `source-db-url`, `target-db-url`, `subset-percentage`.

### Task 4.2: Ephemeral Database Lifecycle Management
* **Goal:** Provision and tear down PostgreSQL branches on Pull Requests.
* **Action Steps:**
  1. Integrate Neon DB API client to create a fresh branch on `pull_request` event (`opened`, `synchronize`).
  2. Stream masked subset data into the temporary branch.
  3. Post a comment on the GitHub PR using `@octokit/rest` with the temporary database connection string.
  4. Trigger branch deletion on `pull_request` (`closed`) event.

---

## Phase 5: Web Dashboard Development (Tasks 5.1 - 5.3)

### Task 5.1: Dark Mode Shell (`apps/web`)
* **Goal:** Build the primary UI layout using Vite, React, Tailwind CSS, and Shadcn UI.
* **Action Steps:**
  1. Configure Tailwind dark palette (`#090D16` background, `#1E293B` panel cards, Indigo `#6366F1` accents).
  2. Build top navigation, project selector, and sidebar layout components.

### Task 5.2: Schema Explorer & Masking Rule Builder View
* **Goal:** Provide an interactive table UI to configure PII strategies.
* **Action Steps:**
  1. Implement a searchable datatable displaying columns, auto-detected PII badges, and strategy selection dropdowns (`Anonymize`, `HMAC Hash`, `Redact`, `Keep`).
  2. Build a live preview panel displaying side-by-side original vs. masked data samples.

### Task 5.3: Ephemeral Envs Monitor & SOC2 Audit Generator
* **Goal:** Provide active preview DB monitoring and audit export functionality.
* **Action Steps:**
  1. Build active PR environment table with quick actions (`Teardown Now`, `Copy Connection String`).
  2. Implement a `Generate SOC2 Compliance Report` button that fetches run logs and generates a cryptographically signed PDF document.

---

## Phase 6: QA, Hardening & Launch (Tasks 6.1 - 6.3)

### Task 6.1: Automated Zero-Leakage Tests
* **Goal:** Guarantee zero raw PII leaks into target databases.
* **Action Steps:**
  1. Write end-to-end integration tests using Vitest that run `envshield sync` against a synthetic seed database filled with mock PII.
  2. Run automated validation queries against the target DB ensuring zero matching raw values remain.

### Task 6.2: Performance Benchmarking
* **Goal:** Ensure processing speeds exceed 100,000 records/sec under 512MB RAM usage.
* **Action Steps:**
  1. Run load tests against a 1,000,000-row database.
  2. Optimize memory consumption using Node.js stream backpressure management.

### Task 6.3: Distribution & Deployment
* **Goal:** Publish packages for developer consumption.
* **Action Steps:**
  1. Publish `@envshield/cli` to NPM registry.
  2. Deploy `apps/control-plane` to production serverless infrastructure.
  3. Deploy `apps/web` dashboard to Cloudflare Pages / Vercel.
