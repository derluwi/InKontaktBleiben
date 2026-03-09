import type { Contact, Settings, ScheduledCall } from '@/types';

const FREQUENCY_DAYS: Record<string, number> = {
  'wöchentlich': 7,
  'zweiwöchentlich': 14,
  'monatlich': 30,
  'quartalsweise': 90,
};

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Format date as YYYY-MM-DD in LOCAL timezone (not UTC) */
function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Export for use in pages */
export { toISODate };

/** Monday of the current week (local time) */
export function getWeekStart(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

/** Target date: when the contact is next due */
function getTargetDate(contact: Contact): Date {
  if (!contact.last_called_at) {
    return new Date(contact.created_at);
  }
  const lastCalled = new Date(contact.last_called_at);
  return addDays(lastCalled, FREQUENCY_DAYS[contact.frequency] ?? 30);
}

/** Days overdue relative to a reference date (negative = not due yet) */
export function getDaysOverdue(contact: Contact, referenceDate: Date = new Date()): number {
  const target = getTargetDate(contact);
  return Math.floor((referenceDate.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));
}

/** Human-readable due status */
export function getDueLabel(contact: Contact): string {
  const days = getDaysOverdue(contact);
  if (days < -1) return `in ${Math.abs(days)} Tagen`;
  if (days === -1) return 'morgen fällig';
  if (days === 0) return 'heute fällig';
  if (days === 1) return '1 Tag überfällig';
  return `${days} Tage überfällig`;
}

/** Generate the weekly schedule for the week starting at weekStart */
export function scheduleWeek(
  contacts: Contact[],
  settings: Settings,
  weekStart: Date,
): ScheduledCall[] {
  const weekKey = toISODate(weekStart);
  if (settings.paused_weeks.includes(weekKey)) return [];

  // Sort contacts by urgency
  const sorted = [...contacts].sort((a, b) => {
    const aNew = !a.last_called_at;
    const bNew = !b.last_called_at;
    if (aNew && !bNew) return -1;
    if (!aNew && bNew) return 1;
    const aDue = getDaysOverdue(a, weekStart);
    const bDue = getDaysOverdue(b, weekStart);
    if (bDue !== aDue) return bDue - aDue;
    // Stable tiebreaker: oldest contact first
    return new Date(a.created_at) < new Date(b.created_at) ? -1 : 1;
  });

  const selected = sorted.slice(0, settings.max_calls_per_week);

  // Helper: skip slots that are already in the past
  const now = new Date();
  function isFuture(date: string, time: string): boolean {
    const [h, m] = time.split(':').map(Number);
    const slot = new Date(date + 'T00:00:00');
    slot.setHours(h, m, 0, 0);
    return slot > now;
  }

  // Build slot pools
  // Beruflich: Mon–Fri at work_call_time
  const beruflichSlots = [0, 1, 2, 3, 4]
    .map((i) => ({ date: toISODate(addDays(weekStart, i)), time: settings.work_call_time }))
    .filter((s) => isFuture(s.date, s.time));

  // Privat: chronologisch — Wochentagabende zuerst (Mo–Fr), dann Wochenende (Sa–So)
  const privatSlots: { date: string; time: string }[] = [];
  if (settings.allow_private_weekday_evening) {
    [0, 1, 2, 3, 4].forEach((i) => {
      const date = toISODate(addDays(weekStart, i));
      if (isFuture(date, settings.private_weekday_time))
        privatSlots.push({ date, time: settings.private_weekday_time });
    });
  }
  if (settings.allow_private_weekend) {
    [5, 6].forEach((i) => {
      const date = toISODate(addDays(weekStart, i));
      if (isFuture(date, settings.private_weekend_time))
        privatSlots.push({ date, time: settings.private_weekend_time });
    });
  }

  const result: ScheduledCall[] = [];
  const usedDates = new Set<string>();

  function pickSlot(
    slots: { date: string; time: string }[],
    contact: Contact,
  ): { date: string; time: string } | undefined {
    // New contacts: enforce 48 h minimum from creation before first appointment
    const earliest = !contact.last_called_at
      ? new Date(new Date(contact.created_at).getTime() + 48 * 60 * 60 * 1000)
      : null;

    return slots.find((s) => {
      if (usedDates.has(s.date)) return false; // max. 1 call per day
      if (earliest) {
        const [h, m] = s.time.split(':').map(Number);
        const slotTime = new Date(s.date + 'T00:00:00');
        slotTime.setHours(h, m, 0, 0);
        if (slotTime < earliest) return false;
      }
      return true;
    });
  }

  for (const contact of selected) {
    const pool = contact.type === 'beruflich' ? beruflichSlots : privatSlots;
    const slot = pickSlot(pool, contact);
    if (slot) {
      result.push({ contact, ...slot });
      usedDates.add(slot.date);
    }
  }

  return result;
}

/** Find a single free slot for one contact in the current week, given already-used dates.
 *  Used when inserting a new contact into an already-frozen weekly plan. */
export function findSlotForContact(
  contact: Contact,
  settings: Settings,
  weekStart: Date,
  usedDates: ReadonlySet<string>,
): { date: string; time: string } | undefined {
  const now = new Date();

  function isFuture(date: string, time: string): boolean {
    const [h, m] = time.split(':').map(Number);
    const slot = new Date(date + 'T00:00:00');
    slot.setHours(h, m, 0, 0);
    return slot > now;
  }

  const beruflichSlots = [0, 1, 2, 3, 4]
    .map((i) => ({ date: toISODate(addDays(weekStart, i)), time: settings.work_call_time }))
    .filter((s) => isFuture(s.date, s.time));

  const privatSlots: { date: string; time: string }[] = [];
  if (settings.allow_private_weekday_evening) {
    [0, 1, 2, 3, 4].forEach((i) => {
      const date = toISODate(addDays(weekStart, i));
      if (isFuture(date, settings.private_weekday_time))
        privatSlots.push({ date, time: settings.private_weekday_time });
    });
  }
  if (settings.allow_private_weekend) {
    [5, 6].forEach((i) => {
      const date = toISODate(addDays(weekStart, i));
      if (isFuture(date, settings.private_weekend_time))
        privatSlots.push({ date, time: settings.private_weekend_time });
    });
  }

  const pool = contact.type === 'beruflich' ? beruflichSlots : privatSlots;
  const earliest = !contact.last_called_at
    ? new Date(new Date(contact.created_at).getTime() + 48 * 60 * 60 * 1000)
    : null;

  return pool.find((s) => {
    if (usedDates.has(s.date)) return false;
    if (earliest) {
      const [h, m] = s.time.split(':').map(Number);
      const slotTime = new Date(s.date + 'T00:00:00');
      slotTime.setHours(h, m, 0, 0);
      if (slotTime < earliest) return false;
    }
    return true;
  });
}
