/**
 * Firestore Security Rules — cross-user isolation test
 *
 * Run with the Firebase Emulator suite:
 *   npx -y firebase-tools emulators:start --only firestore
 *   node scripts/test-rules.mjs
 *
 * What this tests:
 *   1. User A can read their own pipeline         → ALLOWED
 *   2. User B cannot read User A's pipeline       → DENIED  ✓ key test
 *   3. User A can create a run for their pipeline → ALLOWED
 *   4. User B cannot create a run for User A's pipeline → DENIED
 *   5. Client cannot write encrypted secret fields directly → DENIED
 *   6. Client cannot update a run (server-only)   → DENIED
 */

import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { setDoc, getDoc, doc, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';

const PROJECT_ID = 'backup-addd7';

const rules = readFileSync('../firestore.rules', 'utf8');

// ─── Bootstrap ────────────────────────────────────────────────────────────────
const env = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { rules, host: '127.0.0.1', port: 8080 },
});

const userA = { uid: 'user-alice', email: 'alice@example.com' };
const userB = { uid: 'user-bob',   email: 'bob@example.com' };

const PIPELINE_ID = 'pipeline-owned-by-alice';
const RUN_ID      = 'run-001';

// ─── Seed a pipeline document as Admin (bypasses rules) ──────────────────────
await env.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), 'pipelines', PIPELINE_ID), {
    id:      PIPELINE_ID,
    user_id: userA.uid,
    name:    'Alice test pipeline',
    firebase_service_account_encrypted: 'iv:tag:ciphertext', // already encrypted
    storage_credentials: { access_key: 'enc', secret_key: 'enc', bucket: 'b', endpoint: 'e' },
    database_type: 'firestore',
    schedule: 'daily',
    status: 'active',
  });
});

let passed = 0;
let failed = 0;

async function test(label, fn) {
  try {
    await fn();
    console.log(`  ✅  PASS  ${label}`);
    passed++;
  } catch (e) {
    console.error(`  ❌  FAIL  ${label}`);
    console.error(`           ${e.message}`);
    failed++;
  }
}

console.log('\n── Firestore Security Rules Tests ──────────────────────────────\n');

// 1. User A reads their own pipeline — should SUCCEED
const aliceDb = env.authenticatedContext(userA.uid).firestore();
await test('User A can read their own pipeline', () =>
  assertSucceeds(getDoc(doc(aliceDb, 'pipelines', PIPELINE_ID)))
);

// 2. User B reads User A's pipeline — should FAIL
const bobDb = env.authenticatedContext(userB.uid).firestore();
await test('User B is denied reading User A\'s pipeline', () =>
  assertFails(getDoc(doc(bobDb, 'pipelines', PIPELINE_ID)))
);

// 3. Unauthenticated user reads pipeline — should FAIL
const anonDb = env.unauthenticatedContext().firestore();
await test('Unauthenticated user is denied reading any pipeline', () =>
  assertFails(getDoc(doc(anonDb, 'pipelines', PIPELINE_ID)))
);

// 4. Client tries to write firebase_service_account_encrypted directly — should FAIL
await test('Client cannot write firebase_service_account_encrypted directly', () =>
  assertFails(updateDoc(doc(aliceDb, 'pipelines', PIPELINE_ID), {
    firebase_service_account_encrypted: 'new-plaintext-key',
  }))
);

// 5. Client tries to write storage_credentials directly — should FAIL
await test('Client cannot write storage_credentials directly', () =>
  assertFails(updateDoc(doc(aliceDb, 'pipelines', PIPELINE_ID), {
    storage_credentials: { access_key: 'AKID', secret_key: 'secret', bucket: 'b', endpoint: 'e' },
  }))
);

// 6. User A creates a run for their own pipeline — should SUCCEED
await test('User A can create a run for their pipeline', () =>
  assertSucceeds(setDoc(doc(aliceDb, 'runs', RUN_ID), {
    id:              RUN_ID,
    pipelineId:      PIPELINE_ID,
    userId:          userA.uid,
    type:            'backup',
    status:          'running',
    startedAt:       new Date().toISOString(),
    storageUsedBytes: 0,
    logs:            [],
  }))
);

// 7. User B creates a run for User A's pipeline — should FAIL
await test('User B cannot create a run for User A\'s pipeline', () =>
  assertFails(setDoc(doc(bobDb, 'runs', 'run-bob-attempt'), {
    id:              'run-bob-attempt',
    pipelineId:      PIPELINE_ID,   // Alice's pipeline
    userId:          userB.uid,      // Bob claims ownership
    type:            'backup',
    status:          'running',
    startedAt:       new Date().toISOString(),
    storageUsedBytes: 0,
    logs:            [],
  }))
);

// 8. Client tries to update a run (server-only) — should FAIL
await test('Client cannot update run status (server-only operation)', () =>
  assertFails(updateDoc(doc(aliceDb, 'runs', RUN_ID), {
    status: 'completed',
  }))
);

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n── Results: ${passed} passed, ${failed} failed ─────────────────────────────\n`);

await env.cleanup();
process.exit(failed > 0 ? 1 : 0);
