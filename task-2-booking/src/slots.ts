// @rev kc-31
import type { Booking, Master, Service } from './types.ts';
import { now } from './clock.ts';
import { CLEANUP_BUFFER_MIN, fromMinutes, TZ_OFFSET, toMinutes, weekday, overlaps } from './time.ts';

export const SLOT_STEP_MIN = 15;

// Свободные слоты мастера на дату, 'HH:mm' по Алматы
export function getSlots(
  master: Master,
  service: Service,
  date: string,
  bookings: Booking[],
  currentTime: Date = now(),
): string[] {
  const day = master.schedule[weekday(date)];
  if (!day) return [];

  const result: string[] = [];
  const dayStart = new Date(`${date}T00:00:00${TZ_OFFSET}`).getTime();
  const end = toMinutes(day.to);
  for (let t = toMinutes(day.from); t + service.durationMin <= end; t += SLOT_STEP_MIN) {
    const serviceRange = { start: t, end: t + service.durationMin };
    if (day.breaks.some((pause) => overlaps(serviceRange, { start: toMinutes(pause.from), end: toMinutes(pause.to) }))) {
      continue;
    }

    const slotRange = { start: t, end: t + service.durationMin + CLEANUP_BUFFER_MIN };
    const busy = bookings.some((booking) => {
      if (booking.masterId !== master.id || booking.status !== 'active') return false;
      const bookingStart = Date.parse(booking.start);
      const bookingEnd = Date.parse(booking.end);
      if (!Number.isFinite(bookingStart) || !Number.isFinite(bookingEnd)) return false;
      const busyRange = {
        start: (bookingStart - dayStart) / 60_000,
        end: (bookingEnd - dayStart) / 60_000 + CLEANUP_BUFFER_MIN,
      };
      return overlaps(slotRange, busyRange);
    });
    if (busy) continue;

    if (dayStart + t * 60_000 <= currentTime.getTime()) continue;
    result.push(fromMinutes(t));
  }

  return result;
}
