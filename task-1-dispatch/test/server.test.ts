// @rev kc-31
import { once } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDispatchServer, type DispatchData } from '../src/app.ts';
import type { Branch, Order } from '../src/types.ts';

const branch = (over: Partial<Branch>): Branch => ({
  id: 'b-1',
  storeId: 's-1',
  name: 'Филиал',
  city: 'Алматы',
  lat: 43.24,
  lon: 76.91,
  active: true,
  pickupPointIds: [],
  dailyLimit: 1,
  ...over,
});

const order = (over: Partial<Order>): Order => ({
  id: 'o-1',
  storeId: 's-1',
  city: 'Конаев',
  lat: 43.25,
  lon: 76.92,
  pickupPointId: null,
  manualBranchId: null,
  createdAt: '2026-11-15T19:30:00Z',
  ...over,
});

async function listen(data: DispatchData) {
  const server = createDispatchServer(data);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind to a TCP port');
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

function fixture(): DispatchData {
  return {
    branches: [
      branch({ id: 'b-ala-1' }),
      branch({ id: 'b-ast-1', city: 'Астана', lat: 51.128, lon: 71.43 }),
    ],
    orders: [
      order({ id: 'o-101', createdAt: '2026-11-15T19:30:00Z' }),
      order({ id: 'o-102', createdAt: '2026-11-16T04:12:00Z' }),
    ],
    assignments: new Map(),
  };
}

test('POST assignment is idempotent and respects daily limits', async (t) => {
  const running = await listen(fixture());
  t.after(running.close);

  const firstResponse = await fetch(`${running.baseUrl}/orders/o-101/assign`, { method: 'POST' });
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.deepEqual(first, { orderId: 'o-101', branchId: 'b-ala-1', rule: 'geo' });

  const duplicateResponse = await fetch(`${running.baseUrl}/orders/o-101/assign`, { method: 'POST' });
  assert.equal(duplicateResponse.status, 200);
  assert.deepEqual(await duplicateResponse.json(), first);

  const secondResponse = await fetch(`${running.baseUrl}/orders/o-102/assign`, { method: 'POST' });
  assert.equal(secondResponse.status, 200);
  assert.deepEqual(await secondResponse.json(), { orderId: 'o-102', branchId: 'b-ast-1', rule: 'geo' });

  const loadResponse = await fetch(`${running.baseUrl}/branches/b-ala-1/load?date=2026-11-16`);
  assert.equal(loadResponse.status, 200);
  assert.deepEqual(await loadResponse.json(), {
    branchId: 'b-ala-1', date: '2026-11-16', assigned: 1, limit: 1,
  });
});

test('assignment returns 404 for an unknown order', async (t) => {
  const running = await listen(fixture());
  t.after(running.close);

  const response = await fetch(`${running.baseUrl}/orders/missing/assign`, { method: 'POST' });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'order_not_found' });
});

test('branch load validates date and branch id', async (t) => {
  const running = await listen(fixture());
  t.after(running.close);

  const missingDate = await fetch(`${running.baseUrl}/branches/b-ala-1/load`);
  assert.equal(missingDate.status, 400);
  assert.deepEqual(await missingDate.json(), { error: 'invalid_date' });

  const invalidDate = await fetch(`${running.baseUrl}/branches/b-ala-1/load?date=2026-02-30`);
  assert.equal(invalidDate.status, 400);
  assert.deepEqual(await invalidDate.json(), { error: 'invalid_date' });

  const unknownBranch = await fetch(`${running.baseUrl}/branches/missing/load?date=2026-11-16`);
  assert.equal(unknownBranch.status, 404);
  assert.deepEqual(await unknownBranch.json(), { error: 'branch_not_found' });
});
