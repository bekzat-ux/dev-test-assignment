// @rev kc-31
import { once } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBookingServer, type BookingServerOptions } from '../src/app.ts';
import { createBookingRepository } from '../src/store.ts';
import type { Booking, Master, Service } from '../src/types.ts';

const workday = { from: '10:00', to: '13:00', breaks: [] };
const master: Master = {
  id: 'm-1', name: 'Тест',
  schedule: { mon: workday, tue: workday, wed: workday, thu: workday, fri: workday, sat: null, sun: null },
};
const service: Service = { id: 's-cut', name: 'Стрижка', durationMin: 60, masterIds: [master.id] };

async function startServer(options: BookingServerOptions = {}) {
  const server = createBookingServer(options);
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Сервер не открыл TCP-порт');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

function options(initialBookings: Booking[] = [], now = '2030-11-18T04:00:00.000Z'): BookingServerOptions {
  return {
    masters: [master],
    services: [service],
    bookingRepo: createBookingRepository(initialBookings),
    clock: () => new Date(now),
  };
}

test('GET слотов проверяет параметры запроса и возвращает доступные слоты', async (t) => {
  const running = await startServer(options());
  t.after(running.close);

  const response = await fetch(`${running.baseUrl}/masters/m-1/slots?serviceId=s-cut&date=2030-11-18`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    masterId: 'm-1', serviceId: 's-cut', date: '2030-11-18',
    slots: ['10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30', '11:45', '12:00'],
  });

  const invalid = await fetch(`${running.baseUrl}/masters/m-1/slots?serviceId=s-cut&date=2030-02-30`);
  assert.equal(invalid.status, 400);
  const unsupported = await fetch(`${running.baseUrl}/masters/missing/slots?serviceId=s-cut&date=2030-11-18`);
  assert.equal(unsupported.status, 404);
});

test('из одновременных запросов на один слот создаётся только одна запись', async (t) => {
  const running = await startServer(options());
  t.after(running.close);
  const body = JSON.stringify({
    masterId: 'm-1', serviceId: 's-cut', start: '2030-11-18T10:00:00+05:00',
    clientPhone: '8 (701) 234-56-78',
  });

  const responses = await Promise.all([
    fetch(`${running.baseUrl}/bookings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body }),
    fetch(`${running.baseUrl}/bookings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body }),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  const created = await responses.find((response) => response.status === 201)!.json();
  assert.equal(created.clientPhone, '+77012345678');
  assert.equal(created.start, '2030-11-18T05:00:00.000Z');
});

test('отмену можно повторить, но нельзя отменить запись менее чем за два часа', async (t) => {
  const existing: Booking = {
    id: 'bk-1', masterId: master.id, serviceId: service.id,
    start: '2030-11-18T10:00:00.000Z', end: '2030-11-18T11:00:00.000Z',
    clientPhone: '+77012345678', status: 'active',
  };
  const running = await startServer(options([existing], '2030-11-18T06:30:00.000Z'));
  t.after(running.close);

  const first = await fetch(`${running.baseUrl}/bookings/bk-1`, { method: 'DELETE' });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).status, 'cancelled');
  const repeated = await fetch(`${running.baseUrl}/bookings/bk-1`, { method: 'DELETE' });
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).status, 'cancelled');
  const missing = await fetch(`${running.baseUrl}/bookings/missing`, { method: 'DELETE' });
  assert.equal(missing.status, 404);

  const soon: Booking = { ...existing, id: 'bk-soon', start: '2030-11-18T07:00:00.000Z', end: '2030-11-18T08:00:00.000Z' };
  const secondServer = await startServer(options([soon], '2030-11-18T06:30:00.000Z'));
  t.after(secondServer.close);
  const tooLate = await fetch(`${secondServer.baseUrl}/bookings/bk-soon`, { method: 'DELETE' });
  assert.equal(tooLate.status, 409);
  assert.deepEqual(await tooLate.json(), { error: 'too_late' });
});
