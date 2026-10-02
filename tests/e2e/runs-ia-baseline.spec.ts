import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createE2EWorkspace } from './fixtures/workspace.js';

test('record the current information-architecture request baseline', async ({ page }) => {
  const arcadia = await createE2EWorkspace();
  const records: Record<string, string[]> = {};
  const qa = path.join(arcadia.repo, 'docs/qa/runs-information-architecture');
  mkdirSync(qa, { recursive: true });
  try {
    for (const route of ['/runs', '/actions', '/review', '/work-queue', '/flight-deck']) {
      const requests: string[] = [];
      const capture = (request: { url(): string }) => {
        const url = new URL(request.url());
        if (url.pathname.startsWith('/api/')) requests.push(url.pathname + url.search);
      };
      page.on('request', capture);
      await page.goto(arcadia.url + route);
      await expect.poll(() => requests.length).toBeGreaterThan(0);
      // Stop before any follow-up poll. This records requested work, even when
      // a slow CLI response has not finished.
      await page.waitForTimeout(500);
      page.off('request', capture);
      records[route] = requests;
    }
    writeFileSync(path.join(qa, 'baseline-requests.json'), JSON.stringify({
      revision: '3d03d1d75',
      viewport: { width: 390, height: 844 },
      method: 'Cold direct navigation in an isolated E2E workspace; record API requests issued before the first poll. No mutations. Source budget comparison, not live Tailscale latency.',
      requests: records
    }, null, 2) + '\n');
    expect(records['/runs']).toEqual(['/api/approvals']);
    expect(records['/actions']).toEqual(['/api/operator-script']);
    expect(records['/review']).toEqual(['/api/snapshot']);
    expect(records['/work-queue']).toEqual(['/api/work-queue']);
    expect(records['/flight-deck']).toEqual(expect.arrayContaining(['/api/work-queue', '/api/snapshot']));
    expect(records['/flight-deck']).toHaveLength(2);
  } finally {
    await arcadia.stop(false);
  }
});

test('preserve a seeded phone-width baseline of the focused Operator actions page', async ({ page }) => {
  const arcadia = await createE2EWorkspace();
  try {
    // Fixture data illustrates the existing controls; no host action launches.
    await page.route('**/api/approvals', route => route.fulfill({ json: { approvals: [{
      kind: 'agent_ask', id: 'fixture-proposal', project: 'arcadia',
      title: 'Choose where Flight Deck evidence and Production On/Off belong.',
      detail: 'Fixture only: this is the current page, before redesign.',
      gateQuestion: 'reasonable_disagreement', options: [],
      evidence: ['An inactive draft Plan will preserve the three-slice build order.'],
      cost: 'Deterministic — a CLI write, no model call.', createdAt: '2026-09-29T12:00:00Z'
    }] } }));
    await page.route('**/api/operator-script', route => route.fulfill({ json: { scripts: [{
      id: 'fixture-recover-services', title: 'Recover Arcadia host services',
      desiredEffect: 'Restore the worker and verify a fresh heartbeat.',
      authority: { does: ['Restart local services'], never_does: ['Merge or deploy'] },
      repeatable: true, state: { status: 'failed', exitCode: 1, message: 'The worker heartbeat was unavailable.' },
      updatedAt: '2026-09-29T12:00:00Z'
    }] } }));
    await page.goto(arcadia.url + '/actions');
    await expect(page.getByText('The worker heartbeat was unavailable.')).toBeVisible();
    const qa = path.join(arcadia.repo, 'docs/qa/runs-information-architecture');
    mkdirSync(qa, { recursive: true });
    await page.screenshot({ path: path.join(qa, 'actions-seeded-390.png') });
  } finally {
    await arcadia.stop(false);
  }
});
