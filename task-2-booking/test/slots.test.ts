// @rev kc-31
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSlots } from '../src/slots.ts';
import { overlaps, toMinutes } from '../src/time.ts';
import type { Master, Service } from '../src/types.ts';

const day = { from: '10:00', to: '13:00', breaks: [] };

const master: Master = {
  id: 'm-1',
  name: 'Тест',
  schedule: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: null, sun: null },
};

const cut: Service = { id: 's-cut', name: 'Стрижка', durationMin: 60, masterIds: ['m-1'] };

const range = (from: string, to: string) => ({ start: toMinutes(from), end: toMinutes(to) });

test('overlaps: пересекающиеся интервалы', () => {
  assert.equal(overlaps(range('10:00', '11:00'), range('10:30', '11:30')), true);
});

test('overlaps: запись сразу после другой не пересекается', () => {
  assert.equal(overlaps(range('10:00', '11:00'), range('11:00', '12:00')), false);
});

test('getSlots: свободный день', () => {
  // 2030-11-18 — понедельник
  const slots = getSlots(master, cut, '2030-11-18', [], new Date('2030-11-17T00:00:00Z'));
  assert.deepEqual(slots, ['10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30', '11:45', '12:00']);
});

test('getSlots: выходной', () => {
  assert.deepEqual(getSlots(master, cut, '2030-11-23', [], new Date('2030-11-17T00:00:00Z')), []);
});

test('getSlots: услуга не пересекает перерыв', () => {
  const masterWithBreak = {
    ...master,
    schedule: { ...master.schedule, mon: { ...day, breaks: [{ from: '11:00', to: '11:30' }] } },
  };
  const slots = getSlots(masterWithBreak, cut, '2030-11-18', [], new Date('2030-11-17T00:00:00Z'));
  assert.deepEqual(slots, ['10:00', '11:30', '11:45', '12:00']);
});

test('getSlots: активная запись и уборка блокируют слот, отменённая запись не мешает', () => {
  const service: Service = { ...cut, durationMin: 30 };
  const active = {
    id: 'bk-active', masterId: master.id, serviceId: service.id,
    start: '2030-11-18T06:00:00.000Z', end: '2030-11-18T07:00:00.000Z',
    clientPhone: '+77012345678', status: 'active' as const,
  };
  const cancelled = { ...active, id: 'bk-cancelled', status: 'cancelled' as const };
  const now = new Date('2030-11-17T00:00:00Z');
  const withActive = getSlots(master, service, '2030-11-18', [active], now);
  assert.equal(withActive.includes('10:30'), false);
  assert.equal(withActive.includes('12:15'), true);
  const withCancelled = getSlots(master, service, '2030-11-18', [cancelled], now);
  assert.equal(withCancelled.includes('10:30'), true);
});

test('getSlots: слот, который уже начался, не выдаётся', () => {
  const slots = getSlots(master, cut, '2030-11-18', [], new Date('2030-11-18T06:30:00Z'));
  assert.deepEqual(slots, ['11:45', '12:00']);
});
