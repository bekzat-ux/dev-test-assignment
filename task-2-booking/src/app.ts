// @rev kc-31
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { now } from './clock.ts';
import { getSlots } from './slots.ts';
import { bookingRepo, masters, services } from './store.ts';
import { isValidDate, TZ_OFFSET_MS } from './time.ts';
import type { Booking, Master, Service } from './types.ts';
import type { BookingRepository } from './store.ts';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export type BookingServerOptions = {
  masters?: Master[];
  services?: Service[];
  bookingRepo?: BookingRepository;
  clock?: () => Date;
};

export function createBookingServer(options: BookingServerOptions = {}) {
  const masterList = options.masters ?? masters;
  const serviceList = options.services ?? services;
  const repo = options.bookingRepo ?? bookingRepo;
  const clock = options.clock ?? now;

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);

    try {
      if (req.method === 'GET' && url.pathname === '/masters') return send(res, 200, masterList);
      if (req.method === 'GET' && url.pathname === '/services') return send(res, 200, serviceList);

      if (req.method === 'GET' && parts[0] === 'masters' && parts.length === 3 && parts[2] === 'slots') {
        const serviceId = url.searchParams.get('serviceId');
        const date = url.searchParams.get('date');
        if (!serviceId || !date || !isValidDate(date)) return send(res, 400, { error: 'invalid_query' });

        const master = masterList.find((item) => item.id === parts[1]);
        if (!master) return send(res, 404, { error: 'master_not_found' });
        const service = serviceList.find((item) => item.id === serviceId);
        if (!service) return send(res, 404, { error: 'service_not_found' });
        if (!service.masterIds.includes(master.id)) return send(res, 400, { error: 'service_not_offered' });

        const bookings = await repo.listByMaster(master.id);
        return send(res, 200, {
          masterId: master.id,
          serviceId: service.id,
          date,
          slots: getSlots(master, service, date, bookings, clock()),
        });
      }

      if (req.method === 'POST' && url.pathname === '/bookings') {
        let input: unknown;
        try {
          input = await readJson(req);
        } catch {
          return send(res, 400, { error: 'invalid_request' });
        }
        if (!isRecord(input)) return send(res, 400, { error: 'invalid_request' });

        const masterId = input.masterId;
        const serviceId = input.serviceId;
        const start = input.start;
        const phone = input.clientPhone;
        if (typeof masterId !== 'string' || typeof serviceId !== 'string' || typeof start !== 'string' || typeof phone !== 'string') {
          return send(res, 400, { error: 'invalid_request' });
        }

        const master = masterList.find((item) => item.id === masterId);
        if (!master) return send(res, 404, { error: 'master_not_found' });
        const service = serviceList.find((item) => item.id === serviceId);
        if (!service) return send(res, 404, { error: 'service_not_found' });
        if (!service.masterIds.includes(master.id)) return send(res, 400, { error: 'service_not_offered' });

        const startMs = parseZonedIso(start);
        const clientPhone = normalizeKzMobile(phone);
        if (startMs === null || !clientPhone) return send(res, 400, { error: 'invalid_request' });

        const localStart = new Date(startMs + TZ_OFFSET_MS);
        const localDate = localStart.toISOString().slice(0, 10);
        const localTime = `${String(localStart.getUTCHours()).padStart(2, '0')}:${String(localStart.getUTCMinutes()).padStart(2, '0')}`;
        if (startMs % 60_000 !== 0) return send(res, 409, { error: 'slot_unavailable' });

        const currentBookings = await repo.listByMaster(master.id);
        const available = getSlots(master, service, localDate, currentBookings, clock());
        if (!available.includes(localTime)) return send(res, 409, { error: 'slot_unavailable' });

        const booking: Booking = {
          id: randomUUID(),
          masterId: master.id,
          serviceId: service.id,
          start: new Date(startMs).toISOString(),
          end: new Date(startMs + service.durationMin * 60_000).toISOString(),
          clientPhone,
          status: 'active',
        };
        if (!(await repo.insertIfAvailable(booking))) return send(res, 409, { error: 'slot_unavailable' });
        return send(res, 201, booking);
      }

      if (req.method === 'DELETE' && parts[0] === 'bookings' && parts.length === 2) {
        const booking = await repo.get(parts[1]);
        if (!booking) return send(res, 404, { error: 'booking_not_found' });
        if (booking.status === 'cancelled') return send(res, 200, booking);
        if (Date.parse(booking.start) - clock().getTime() < TWO_HOURS_MS) {
          return send(res, 409, { error: 'too_late' });
        }

        const cancelled: Booking = { ...booking, status: 'cancelled' };
        await repo.update(booking.id, { status: 'cancelled' });
        return send(res, 200, cancelled);
      }

      return send(res, 404, { error: 'not_found' });
    } catch (err) {
      console.error(err);
      return send(res, 500, { error: 'internal' });
    }
  });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseZonedIso(value: string): number | null {
  const match = /^(\d{4}-\d{2}-\d{2})T.*(?:Z|[+-]\d{2}:?\d{2})$/.exec(value);
  if (!match || !isValidDate(match[1])) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeKzMobile(value: string): string | null {
  const input = value.trim();
  if (!/^\+?\d[\d\s().-]*$/.test(input)) return null;
  let digits = input.replace(/\D/g, '');
  if (digits.length !== 11) return null;
  if (digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (!/^77\d{9}$/.test(digits)) return null;
  return `+${digits}`;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
