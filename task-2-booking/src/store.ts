// @rev kc-31
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Booking, Master, Service } from './types.ts';
import { CLEANUP_BUFFER_MIN } from './time.ts';

const dataDir = process.env.DATA_DIR ?? join(import.meta.dirname, '..', 'data');

function load<T>(file: string): T {
  return JSON.parse(readFileSync(join(dataDir, file), 'utf8')) as T;
}

export const masters: Master[] = load('masters.json');
export const services: Service[] = load('services.json');

export type BookingRepository = {
  listByMaster(masterId: string): Promise<Booking[]>;
  get(id: string): Promise<Booking | null>;
  insertIfAvailable(booking: Booking): Promise<boolean>;
  update(id: string, patch: Partial<Booking>): Promise<void>;
};

// Имитация сетевой задержки до БД. Не убирать: в проде запросы тоже не мгновенные.
const latency = () => new Promise((r) => setTimeout(r, 5 + Math.random() * 15));

export function createBookingRepository(initialBookings: Booking[]): BookingRepository {
  const bookings = initialBookings.map((booking) => ({ ...booking }));

  return {
    async listByMaster(masterId: string): Promise<Booking[]> {
      await latency();
      return bookings.filter((booking) => booking.masterId === masterId).map((booking) => ({ ...booking }));
    },

    async get(id: string): Promise<Booking | null> {
      await latency();
      const found = bookings.find((booking) => booking.id === id);
      return found ? { ...found } : null;
    },

    async insertIfAvailable(booking: Booking): Promise<boolean> {
      await latency();
      const start = Date.parse(booking.start);
      const end = Date.parse(booking.end);
      const bufferMs = CLEANUP_BUFFER_MIN * 60_000;
      const conflicts = bookings.some((existing) => {
        if (existing.masterId !== booking.masterId || existing.status !== 'active') return false;
        const existingStart = Date.parse(existing.start);
        const existingEnd = Date.parse(existing.end);
        return start < existingEnd + bufferMs && existingStart < end + bufferMs;
      });
      if (conflicts) return false;
      bookings.push({ ...booking });
      return true;
    },

    async update(id: string, patch: Partial<Booking>): Promise<void> {
      await latency();
      const found = bookings.find((booking) => booking.id === id);
      if (found) Object.assign(found, patch);
    },
  };
}

export const bookingRepo = createBookingRepository(load('bookings.json'));
