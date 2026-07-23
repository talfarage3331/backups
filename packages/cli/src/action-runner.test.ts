import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import { run } from './action-runner.js';

// Mock execSync to avoid running actual CLI sync during tests
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

describe('EnvShield Action Runner', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let fetchSpy: any;

  beforeEach(() => {
    // Backup process.env
    originalEnv = { ...process.env };
    
    // Clear all mock calls
    vi.mocked(execSync).mockClear();

    // Mock global fetch
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    // Restore process.env and mocks
    process.env = originalEnv;
    fetchSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('should run a standard sync if not in PR context and targetDbUrl is provided', async () => {
    process.env['INPUT_SOURCE_DB_URL'] = 'postgresql://localhost:5432/source';
    process.env['INPUT_TARGET_DB_URL'] = 'postgresql://localhost:5432/target';
    process.env['INPUT_SUBSET_PERCENTAGE'] = '10';
    process.env['INPUT_CONTROL_PLANE_URL'] = 'http://localhost:3001';
    process.env['GITHUB_EVENT_NAME'] = 'push';

    await run();

    // Verify execSync was called to run the standard sync CLI command
    expect(execSync).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(execSync).mock.calls[0]?.[0] as string;
    expect(callArgs).toContain('sync');
    expect(callArgs).toContain('--source "postgresql://localhost:5432/source"');
    expect(callArgs).toContain('--target "postgresql://localhost:5432/target"');
    expect(callArgs).toContain('--subset "10"');
  });

  it('should provision a Neon branch and run sync when PR is opened', async () => {
    process.env['INPUT_SOURCE_DB_URL'] = 'postgresql://localhost:5432/source';
    process.env['INPUT_NEON_API_KEY'] = 'neon-api-key-123';
    process.env['INPUT_NEON_PROJECT_ID'] = 'neon-proj-456';
    process.env['INPUT_GITHUB_TOKEN'] = 'gh-token-789';
    process.env['GITHUB_EVENT_NAME'] = 'pull_request';
    process.env['GITHUB_REPOSITORY'] = 'test-owner/test-repo';
    process.env['GITHUB_EVENT_PATH'] = './mock-event.json';

    // Mock the event payload file
    const mockEvent = {
      action: 'opened',
      pull_request: {
        number: 42
      }
    };
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockEvent) as any);

    // Mock Neon and GitHub API responses sequentially
    fetchSpy.mockImplementation((url: string, init?: any) => {
      // 1. GET /branches vs POST /branches
      if (url.endsWith('/branches')) {
        if (init?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              branch: { id: 'br-new-999', name: 'pr-42' },
              endpoints: [{ id: 'ep-111', host: 'ep-host.neon.tech' }]
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ branches: [] }),
        });
      }
      // 3. GET /branches/br-new-999 (polling readiness status)
      if (url.endsWith('/branches/br-new-999')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ branch: { current_state: 'ready' } }),
        });
      }
      // 4. GET /branches/br-new-999/databases
      if (url.endsWith('/databases')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ databases: [{ name: 'neondb' }] }),
        });
      }
      // 5. GET /branches/br-new-999/roles
      if (url.endsWith('/roles')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ roles: [{ name: 'neondb_owner' }] }),
        });
      }
      // 6. GET /connection_uri
      if (url.includes('/connection_uri')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ connection_uri: 'postgresql://neondb_owner:p4ssword@ep-host.neon.tech/neondb' }),
        });
      }
      // 7. POST GitHub comment
      if (url.includes('api.github.com/repos/test-owner/test-repo/issues/42/comments')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 1000 }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    await run();

    // Verify Neon API calls
    expect(fetchSpy).toHaveBeenCalled();
    
    // Verify sync was executed on the new Neon branch URI
    expect(execSync).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(execSync).mock.calls[0]?.[0] as string;
    expect(callArgs).toContain('--target "postgresql://neondb_owner:p4ssword@ep-host.neon.tech/neondb"');

    // Verify comment was posted with password masked
    const commentCall = fetchSpy.mock.calls.find((call: any) => call[0].includes('api.github.com'));
    expect(commentCall).toBeDefined();
    const commentBody = JSON.parse(commentCall[1].body).body;
    expect(commentBody).toContain('postgresql://neondb_owner:••••••••@ep-host.neon.tech/neondb');
    expect(commentBody).not.toContain('p4ssword');
  });

  it('should delete Neon branch when PR is closed', async () => {
    process.env['INPUT_SOURCE_DB_URL'] = 'postgresql://localhost:5432/source';
    process.env['INPUT_NEON_API_KEY'] = 'neon-api-key-123';
    process.env['INPUT_NEON_PROJECT_ID'] = 'neon-proj-456';
    process.env['INPUT_GITHUB_TOKEN'] = 'gh-token-789';
    process.env['GITHUB_EVENT_NAME'] = 'pull_request';
    process.env['GITHUB_REPOSITORY'] = 'test-owner/test-repo';
    process.env['GITHUB_EVENT_PATH'] = './mock-event.json';

    const mockEvent = {
      action: 'closed',
      pull_request: {
        number: 42
      }
    };
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockEvent) as any);

    fetchSpy.mockImplementation((url: string, init?: any) => {
      // 1. GET /branches -> return existing branch
      if (url.endsWith('/branches') && init?.method !== 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ branches: [{ id: 'br-old-999', name: 'pr-42' }] }),
        });
      }
      // 2. DELETE /branches/br-old-999
      if (url.endsWith('/branches/br-old-999') && init?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      }
      // 3. POST GitHub comment
      if (url.includes('api.github.com/repos/test-owner/test-repo/issues/42/comments')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 1001 }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    await run();

    // Verify Neon delete request was called
    const deleteCall = fetchSpy.mock.calls.find((call: any) => call[0].endsWith('/branches/br-old-999') && call[1]?.method === 'DELETE');
    expect(deleteCall).toBeDefined();

    // Verify comment was posted
    const commentCall = fetchSpy.mock.calls.find((call: any) => call[0].includes('api.github.com'));
    expect(commentCall).toBeDefined();
    const commentBody = JSON.parse(commentCall[1].body).body;
    expect(commentBody).toContain('ephemeral preview database for this Pull Request has been successfully deleted.');
  });
});
