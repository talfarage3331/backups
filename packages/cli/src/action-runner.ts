import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// Read GitHub Actions Inputs / Environment variables (re-evaluated during run())
let apiKey: string | undefined;
let sourceDbUrl: string | undefined;
let targetDbUrl: string | undefined;
let subsetPercentage = '5';
let controlPlaneUrl = 'http://localhost:3001';

let neonApiKey: string | undefined;
let neonProjectId: string | undefined;
let neonParentBranch = 'main';
let showPlainCredentials = false;

let githubToken: string | undefined;
let eventPath: string | undefined;
let repository: string | undefined;
let eventName: string | undefined;

function initializeInputs() {
  apiKey = process.env['INPUT_ENVSHIELD_API_KEY'];
  sourceDbUrl = process.env['INPUT_SOURCE_DB_URL'];
  targetDbUrl = process.env['INPUT_TARGET_DB_URL'];
  subsetPercentage = process.env['INPUT_SUBSET_PERCENTAGE'] || '5';
  controlPlaneUrl = process.env['INPUT_CONTROL_PLANE_URL'] || 'http://localhost:3001';

  neonApiKey = process.env['INPUT_NEON_API_KEY'];
  neonProjectId = process.env['INPUT_NEON_PROJECT_ID'];
  neonParentBranch = process.env['INPUT_NEON_PARENT_BRANCH'] || 'main';
  showPlainCredentials = process.env['INPUT_SHOW_PLAIN_CREDENTIALS'] === 'true';

  githubToken = process.env['INPUT_GITHUB_TOKEN'];
  eventPath = process.env['GITHUB_EVENT_PATH'];
  repository = process.env['GITHUB_REPOSITORY'];
  eventName = process.env['GITHUB_EVENT_NAME'];
}

// Helper to make API requests to Neon
async function neonApi(endpoint: string, method = 'GET', body?: any) {
  if (!neonApiKey || !neonProjectId) {
    throw new Error('Neon API key and Project ID are required for this operation.');
  }

  const url = `https://console.neon.tech/api/v2/projects/${neonProjectId}${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${neonApiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Neon API error: ${res.status} ${res.statusText} - ${errText}`);
  }

  return res.json();
}

// Find a branch ID by its name
async function findBranchId(name: string): Promise<string | null> {
  const data = await neonApi('/branches') as { branches: Array<{ id: string; name: string }> };
  const branch = data.branches.find(b => b.name === name);
  return branch ? branch.id : null;
}

// Delete a branch by branch ID
async function deleteBranch(branchId: string) {
  console.log(`[EnvShield CI] Deleting Neon branch ${branchId}...`);
  await neonApi(`/branches/${branchId}`, 'DELETE');
  console.log(`[EnvShield CI] Neon branch successfully deleted.`);
}

// Create a branch and wait for its compute endpoint
async function createBranch(name: string, parentNameOrId: string) {
  console.log(`[EnvShield CI] Creating Neon branch "${name}" from "${parentNameOrId}"...`);
  
  const payload: any = {
    branch: { name },
    endpoints: [{ type: 'read_write' }]
  };

  if (parentNameOrId) {
    const parentId = await findBranchId(parentNameOrId);
    if (parentId) {
      payload.branch.parent_id = parentId;
    } else {
      console.log(`[EnvShield CI] Warning: Parent branch "${parentNameOrId}" not found. Creating from project default branch.`);
    }
  }

  const res = await neonApi('/branches', 'POST') as {
    branch: { id: string; name: string };
    endpoints: Array<{ id: string; host: string }>;
  };
  
  console.log(`[EnvShield CI] Provisioned Neon branch ID: ${res.branch.id}`);
  return res;
}

// Poll Neon API until the branch status is ready
async function waitForBranchReady(branchId: string) {
  console.log(`[EnvShield CI] Waiting for branch ${branchId} to be ready...`);
  for (let i = 0; i < 30; i++) {
    const data = await neonApi(`/branches/${branchId}`) as { branch: { current_state: string } };
    if (data.branch.current_state === 'ready') {
      console.log(`[EnvShield CI] Neon branch is ready.`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw new Error(`Timeout waiting for Neon branch ${branchId} to become ready.`);
}

// Retrieve connection string for a Neon branch
async function getConnectionUri(branchId: string): Promise<string> {
  // 1. Fetch database name
  const dbsData = await neonApi(`/branches/${branchId}/databases`) as { databases: Array<{ name: string }> };
  const dbName = dbsData.databases[0]?.name || 'neondb';

  // 2. Fetch role name
  const rolesData = await neonApi(`/branches/${branchId}/roles`) as { roles: Array<{ name: string }> };
  const roleName = rolesData.roles[0]?.name || 'neondb_owner';

  // 3. Fetch connection URI
  const connData = await neonApi(`/connection_uri?branch_id=${branchId}&database_name=${dbName}&role_name=${roleName}`) as { connection_uri: string };
  return connData.connection_uri;
}

// Helper to post a comment on a GitHub PR
async function postPrComment(owner: string, repo: string, prNumber: number, commentBody: string) {
  if (!githubToken) {
    console.log(`[EnvShield CI] GITHUB_TOKEN not provided. Skipping PR comment.`);
    return;
  }

  console.log(`[EnvShield CI] Posting PR comment to ${owner}/${repo} PR #${prNumber}...`);
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
    method: 'POST',
    headers: {
      'Authorization': `token ${githubToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'EnvShield-CI-Action',
    },
    body: JSON.stringify({ body: commentBody }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[EnvShield CI] Failed to post GitHub comment: ${res.status} - ${errText}`);
  } else {
    console.log(`[EnvShield CI] PR comment posted successfully.`);
  }
}

// Main execution block
async function run() {
  initializeInputs();

  if (!sourceDbUrl) {
    console.error('Error: INPUT_SOURCE_DB_URL is required.');
    process.exit(1);
  }

  const cliPath = path.join(__dirname, 'index.js');

  // Verify whether we are running in a GitHub PR context with Neon configured
  const isPrEvent = eventName === 'pull_request';
  const hasNeonConfig = !!(neonApiKey && neonProjectId);

  if (isPrEvent && hasNeonConfig) {
    if (!eventPath || !fs.existsSync(eventPath)) {
      console.error('Error: GITHUB_EVENT_PATH file is missing.');
      process.exit(1);
    }

    if (!repository) {
      console.error('Error: GITHUB_REPOSITORY is missing.');
      process.exit(1);
    }

    const [owner, repo] = repository.split('/');
    if (!owner || !repo) {
      console.error(`Error: Invalid repository format: ${repository}`);
      process.exit(1);
    }

    const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    const prNumber = event.pull_request?.number || event.number;
    const prAction = event.action;

    if (!prNumber) {
      console.error('Error: Pull Request number not found in event payload.');
      process.exit(1);
    }

    const branchName = `pr-${prNumber}`;

    if (prAction === 'opened' || prAction === 'synchronize' || prAction === 'reopened') {
      console.log(`\n[EnvShield CI] Processing PR #${prNumber} (${prAction}) - setting up ephemeral database...`);

      // 1. Clean up existing branch if it exists (fresh recreation)
      const existingBranchId = await findBranchId(branchName);
      if (existingBranchId) {
        await deleteBranch(existingBranchId);
      }

      // 2. Create branch
      const branchRes = await createBranch(branchName, neonParentBranch);
      const branchId = branchRes.branch.id;

      // 3. Wait for branch status to be ready
      await waitForBranchReady(branchId);

      // 4. Retrieve connection URI
      const connectionUri = await getConnectionUri(branchId);

      // 5. Run standard sync from source database to Neon branch
      console.log(`\n[EnvShield CI] Running envshield sync to populate ephemeral DB...`);
      const cmd = `node "${cliPath}" sync --source "${sourceDbUrl}" --target "${connectionUri}" --subset "${subsetPercentage}" --control-plane "${controlPlaneUrl}" ${apiKey ? `--api-key "${apiKey}"` : ''}`;
      
      try {
        execSync(cmd, { stdio: 'inherit' });
      } catch (err) {
        console.error('[EnvShield CI] Sync execution failed:', err);
        process.exit(1);
      }

      // 6. Format and mask credentials for the comment
      let displayUri = connectionUri;
      if (!showPlainCredentials) {
        displayUri = connectionUri.replace(/(postgresql:\/\/|postgres:\/\/)([^:]+):([^@]+)@/, '$1$2:••••••••@');
      }

      // 7. Post comment
      const commentBody = `### 🛡️ EnvShield Ephemeral Database Provisioned

An isolated, masked, and subsetted preview database has been successfully provisioned for this Pull Request.

**Database Connection String:**
\`\`\`
${displayUri}
\`\`\`

*This database has been populated with a ${subsetPercentage}% subset of masked data from the source database. It will be automatically deleted when this Pull Request is closed.*`;
      
      await postPrComment(owner, repo, prNumber, commentBody);

    } else if (prAction === 'closed') {
      console.log(`\n[EnvShield CI] Processing PR #${prNumber} (closed) - tearing down ephemeral database...`);
      
      const branchId = await findBranchId(branchName);
      if (branchId) {
        await deleteBranch(branchId);
        
        const commentBody = `### 🗑️ EnvShield Ephemeral Database Torn Down

The ephemeral preview database for this Pull Request has been successfully deleted.`;
        await postPrComment(owner, repo, prNumber, commentBody);
      } else {
        console.log(`[EnvShield CI] Ephemeral database branch "${branchName}" already deleted or not found.`);
      }
    } else {
      console.log(`[EnvShield CI] Pull request action "${prAction}" ignored.`);
    }

  } else {
    // Fallback: Run standard sync if targetDbUrl is specified (e.g. standard push sync)
    if (targetDbUrl) {
      console.log(`\n[EnvShield CI] Running standard sync directly to target database...`);
      const cmd = `node "${cliPath}" sync --source "${sourceDbUrl}" --target "${targetDbUrl}" --subset "${subsetPercentage}" --control-plane "${controlPlaneUrl}" ${apiKey ? `--api-key "${apiKey}"` : ''}`;
      
      try {
        execSync(cmd, { stdio: 'inherit' });
      } catch (err) {
        console.error('[EnvShield CI] Standard sync execution failed:', err);
        process.exit(1);
      }
    } else {
      console.log(`[EnvShield CI] Skipping pipeline execution: not in a PR context (or Neon credentials missing) and target-db-url was not provided.`);
    }
  }
}

export { run };

if (require.main === module || process.env['NODE_ENV'] === 'cli-direct') {
  run().catch(err => {
    console.error('[EnvShield CI] Action Runner failed with error:', err);
    process.exit(1);
  });
}
