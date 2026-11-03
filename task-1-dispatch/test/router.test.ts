// @rev kc-31
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignBranch } from '../src/router.ts';
import { branches } from '../src/store.ts';
import { distanceKm } from '../src/geo.ts';
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
  dailyLimit: 100,
  ...over,
});

const order = (over: Partial<Order>): Order => ({
  id: 'o-1',
  storeId: 's-1',
  city: 'Алматы',
  lat: 43.25,
  lon: 76.92,
  pickupPointId: null,
  manualBranchId: null,
  createdAt: '2026-11-16T06:00:00Z',
  ...over,
});

const almaty = branch({ id: 'b-ala', city: 'Алматы', lat: 43.2567, lon: 76.9286 });
const astana = branch({ id: 'b-ast', city: 'Астана', lat: 51.128, lon: 71.43 });

test('distanceKm: Алматы — Астана около 970 км', () => {
  const d = distanceKm(43.2389, 76.8897, 51.1694, 71.4491);
  assert.ok(Math.abs(d - 970) < 15, `получили ${d.toFixed(1)}`);
});

test('manual: заказ уходит в указанный филиал', () => {
  const res = assignBranch(order({ manualBranchId: 'b-ast' }), [almaty, astana]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ast', rule: 'manual' });
});

test('manual: неактивный филиал пропускается', () => {
  const closed = { ...astana, active: false };
  const res = assignBranch(order({ manualBranchId: 'b-ast' }), [almaty, closed]);
  assert.notEqual(res.rule, 'manual');
});

test('single: у магазина один активный филиал', () => {
  const res = assignBranch(order({ city: 'Шымкент' }), [almaty]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala', rule: 'single' });
});

test('geo: выбирается ближайший филиал', () => {
  const res = assignBranch(order({ city: 'Конаев', lat: 43.25, lon: 76.93 }), [almaty, astana]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala', rule: 'geo' });
});

test('geo: без координат заказ не распределяется', () => {
  const res = assignBranch(order({ city: 'Конаев', lat: null, lon: null }), [almaty, astana]);
  assert.equal(res.rule, 'unassigned');
});

test('pickup_point: пункт выдачи закреплён за филиалом', () => {
  const withPickup = branch({ id: 'b-pickup', pickupPointIds: ['pp-1'] });
  const res = assignBranch(order({ pickupPointId: 'pp-1' }), [withPickup, astana]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-pickup', rule: 'pickup_point' });
});

test('city: в городе заказа один филиал магазина', () => {
  const res = assignBranch(order({ city: 'Алматы' }), [almaty, astana]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala', rule: 'city' });
});
test('geo: если в городе несколько филиалов, выбирается ближайший из них', () => {
  const astana = branches.find((b) => b.id === 'b-ast-1');
  assert.ok(astana);
  const res = assignBranch(
    order({ city: 'Алматы', lat: astana.lat, lon: astana.lon }),
    branches.filter((b) => b.storeId === 's-1'),
  );
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala-2', rule: 'geo' });
});
test('лимит: заполненный филиал пропускается по дате Алматы', () => {
  const limited = branch({ id: 'b-limited', dailyLimit: 1 });
  const fallback = branch({ id: 'b-fallback', city: 'Астана', lat: 51.128, lon: 71.43 });
  const previousOrder = order({ id: 'o-previous', createdAt: '2026-11-15T20:00:00Z' });
  const previousAssignment = { orderId: previousOrder.id, branchId: limited.id, rule: 'geo' as const };
  const res = assignBranch(
    order({ id: 'o-current', createdAt: '2026-11-16T01:00:00Z' }),
    [limited, fallback],
    { assignments: new Map([[previousOrder.id, previousAssignment]]), orders: [previousOrder] },
  );
  assert.deepEqual(res, { orderId: 'o-current', branchId: fallback.id, rule: 'geo' });
});

test('лимит: заказы разных алматинских суток считаются отдельно', () => {
  const limited = branch({ id: 'b-limited', dailyLimit: 1 });
  const fallback = branch({ id: 'b-fallback', city: 'Астана', lat: 51.128, lon: 71.43 });
  const previousOrder = order({ id: 'o-previous', createdAt: '2026-11-15T20:00:00Z' });
  const previousAssignment = { orderId: previousOrder.id, branchId: limited.id, rule: 'geo' as const };
  const res = assignBranch(
    order({ id: 'o-current', createdAt: '2026-11-16T20:00:00Z' }),
    [limited, fallback],
    { assignments: new Map([[previousOrder.id, previousAssignment]]), orders: [previousOrder] },
  );
  assert.deepEqual(res, { orderId: 'o-current', branchId: limited.id, rule: 'city' });
});

test('лимит: если все филиалы заполнены, заказ не распределяется', () => {
  const onlyBranch = branch({ id: 'b-full', dailyLimit: 0 });
  const res = assignBranch(order({}), [onlyBranch]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: null, rule: 'unassigned' });
});
test('manual: назначение не проверяет дневной лимит', () => {
  const limited = branch({ id: 'b-limited', dailyLimit: 1 });
  const previousOrder = order({ id: 'o-previous', createdAt: '2026-11-16T05:00:00Z' });
  const previousAssignment = { orderId: previousOrder.id, branchId: limited.id, rule: 'geo' as const };
  const res = assignBranch(
    order({ id: 'o-current', manualBranchId: limited.id }),
    [limited, astana],
    { assignments: new Map([[previousOrder.id, previousAssignment]]), orders: [previousOrder] },
  );
  assert.deepEqual(res, { orderId: 'o-current', branchId: limited.id, rule: 'manual' });
});
