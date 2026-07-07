// Vercel runs functions in UTC. The scheduling math below uses local-time Date
// operations (it was written for the user's browser, which is in Berlin).
// Assigning process.env.TZ makes Node call tzset(), so every Date operation below runs
// in Europe/Berlin — matching the browser exactly. For guaranteed correctness this is
// also set as a Vercel project env var (TZ=Europe/Berlin); this line covers `vercel dev`
// and acts as a belt-and-suspenders in case the env var is missing.
process.env.TZ = 'Europe/Berlin';

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// ─── Types (inline — Vercel serverless functions cannot bundle cross-directory ──
//     imports from ../src, they fail at runtime with ERR_MODULE_NOT_FOUND). ─────
type ContactType = 'beruflich' | 'privat';
type Frequency = 'wöchentlich' | 'zweiwöchentlich' | 'monatlich' | 'zweimonatlich' | 'halbjährlich' | 'quartalsweise';

interface Contact {
  id: string;
  name: string;
  type: ContactType;
  frequency: Frequency;
  phone?: string;
  notes?: string;
  last_called_at?: string;
  created_at: string;
}

interface Settings {
  id: number;
  max_calls_per_week: number;
  work_call_time: string;
  private_weekday_time: string;
  private_weekend_time: string;
  allow_private_weekday_evening: boolean;
  allow_private_weekend: boolean;
  paused_weeks: string[];
  calendar_token: string;
}

interface ScheduledCall {
  contact: Contact;
  date: string;
  time: string;
}

// ─── Scheduling logic (kept in sync with src/lib/scheduling.ts) ────────────────
// This is a verbatim copy of the shared scheduling module. It has to live here
// because Vercel cannot bundle the ../src import (see the type block above and
// commit 4301e1f, where api/calendar.ts hit the same wall). When you change
// src/lib/scheduling.ts, mirror the change here.

const FREQUENCY_DAYS: Record<string, number> = {
  'wöchentlich': 7,
  'zweiwöchentlich': 14,
  'monatlich': 30,
  'zweimonatlich': 60,
  'halbjährlich': 182,
  'quartalsweise': 90,
};

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Format date as YYYY-MM-DD in LOCAL timezone (= Europe/Berlin here) */
function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Monday of the current week (local time) */
function getWeekStart(date: Date = new Date()): Date {
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
function getDaysOverdue(contact: Contact, referenceDate: Date = new Date()): number {
  const target = getTargetDate(contact);
  return Math.floor((referenceDate.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));
}

/** Generate the weekly schedule for the week starting at weekStart */
function scheduleWeek(contacts: Contact[], settings: Settings, weekStart: Date): ScheduledCall[] {
  const weekKey = toISODate(weekStart);
  if ((settings.paused_weeks ?? []).includes(weekKey)) return [];

  const sorted = [...contacts].sort((a, b) => {
    const aNew = !a.last_called_at;
    const bNew = !b.last_called_at;
    if (aNew && !bNew) return -1;
    if (!aNew && bNew) return 1;
    const aDue = getDaysOverdue(a, weekStart);
    const bDue = getDaysOverdue(b, weekStart);
    if (bDue !== aDue) return bDue - aDue;
    return new Date(a.created_at) < new Date(b.created_at) ? -1 : 1;
  });

  const weekEnd = addDays(weekStart, 6);
  const dueThisWeek = sorted.filter((c) => getDaysOverdue(c, weekEnd) >= 0);
  const selected = dueThisWeek.slice(0, settings.max_calls_per_week);

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

  const result: ScheduledCall[] = [];
  const usedDates = new Map<string, number>();

  function pickSlot(slots: { date: string; time: string }[], contact: Contact): { date: string; time: string } | undefined {
    const earliest = !contact.last_called_at
      ? new Date(new Date(contact.created_at).getTime() + 12 * 60 * 60 * 1000)
      : null;

    function eligible(s: { date: string; time: string }): boolean {
      const [h, m] = s.time.split(':').map(Number);
      const slotTime = new Date(s.date + 'T00:00:00');
      slotTime.setHours(h, m, 0, 0);
      if (earliest && slotTime < earliest) return false;
      const dueDate = getTargetDate(contact);
      const earliestDue = new Date(dueDate.getTime() - 24 * 60 * 60 * 1000);
      return slotTime >= earliestDue;
    }

    const freeSlot = slots.find((s) => (usedDates.get(s.date) ?? 0) === 0 && eligible(s));
    if (freeSlot) return freeSlot;
    if (settings.max_calls_per_week > 7) {
      return slots.find((s) => eligible(s));
    }
    return undefined;
  }

  const ordered = [
    ...selected.filter((c) => c.type === 'beruflich'),
    ...selected.filter((c) => c.type === 'privat'),
  ];

  for (const contact of ordered) {
    const pool = contact.type === 'beruflich' ? beruflichSlots : privatSlots;
    const slot = pickSlot(pool, contact);
    if (slot) {
      result.push({ contact, ...slot });
      usedDates.set(slot.date, (usedDates.get(slot.date) ?? 0) + 1);
    }
  }

  return result;
}

/** Find a single free slot for one contact in the current week, given already-used dates. */
function findSlotForContact(
  contact: Contact,
  settings: Settings,
  weekStart: Date,
  usedDates: ReadonlyMap<string, number>,
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

  const weekEnd = addDays(weekStart, 6);
  if (getDaysOverdue(contact, weekEnd) < 0) return undefined;

  const pool = contact.type === 'beruflich' ? beruflichSlots : privatSlots;
  const earliest = !contact.last_called_at
    ? new Date(new Date(contact.created_at).getTime() + 12 * 60 * 60 * 1000)
    : null;

  function eligible(s: { date: string; time: string }): boolean {
    const [h, m] = s.time.split(':').map(Number);
    const slotTime = new Date(s.date + 'T00:00:00');
    slotTime.setHours(h, m, 0, 0);
    if (earliest && slotTime < earliest) return false;
    const dueDate = getTargetDate(contact);
    const earliestDue = new Date(dueDate.getTime() - 24 * 60 * 60 * 1000);
    return slotTime >= earliestDue;
  }

  const freeSlot = pool.find((s) => (usedDates.get(s.date) ?? 0) === 0 && eligible(s));
  if (freeSlot) return freeSlot;
  if (settings.max_calls_per_week > 7) {
    return pool.find((s) => eligible(s));
  }
  return undefined;
}

interface PlanRow {
  week_start: string;
  contact_id: string;
  scheduled_date: string;
  scheduled_time: string;
}

/**
 * Compute the `weekly_plan` rows that still need to be inserted for the given week.
 * See src/lib/scheduling.ts for the authoritative documentation. Idempotent: an
 * empty stored plan freezes the whole week; a non-empty one only slots in new arrivals.
 */
function computePlanInserts(
  contacts: Contact[],
  settings: Settings,
  weekStart: Date,
  storedPlan: ReadonlyArray<{ contact_id: string; scheduled_date: string }>,
): PlanRow[] {
  const weekKey = toISODate(weekStart);
  if ((settings.paused_weeks ?? []).includes(weekKey)) return [];

  if (storedPlan.length === 0) {
    return scheduleWeek(contacts, settings, weekStart).map(({ contact, date, time }) => ({
      week_start: weekKey,
      contact_id: contact.id,
      scheduled_date: date,
      scheduled_time: time,
    }));
  }

  const plannedIds = new Set(storedPlan.map((p) => p.contact_id));
  const usedDates = new Map<string, number>();
  storedPlan.forEach((p) => usedDates.set(p.scheduled_date, (usedDates.get(p.scheduled_date) ?? 0) + 1));

  const unplanned = contacts
    .filter((c) => !plannedIds.has(c.id))
    .sort((a, b) => getDaysOverdue(b) - getDaysOverdue(a));

  const additions: PlanRow[] = [];
  for (const contact of unplanned) {
    const slot = findSlotForContact(contact, settings, weekStart, usedDates);
    if (slot) {
      additions.push({ week_start: weekKey, contact_id: contact.id, scheduled_date: slot.date, scheduled_time: slot.time });
      usedDates.set(slot.date, (usedDates.get(slot.date) ?? 0) + 1);
    }
  }
  return additions;
}

// ─── Handler ───────────────────────────────────────────────────────────────────

/**
 * Daily cron job: ensures the current week's plan is frozen in `weekly_plan`.
 *
 * This decouples plan-freezing from a human opening the app. Previously the plan was
 * only written when WeeklyViewPage loaded; if the user never opened the app, the ICS
 * feed (which only reads the frozen plan) stayed empty — a vicious cycle. Running this
 * daily means the week is always frozen, and it self-heals if a run is ever skipped.
 * It is idempotent: re-running only slots in contacts that have no entry yet.
 *
 * Scheduled via vercel.json (`crons`). Vercel authenticates cron requests with the
 * `CRON_SECRET` env var (Authorization: Bearer <secret>) when it is configured.
 *
 * @param req Vercel request (cron sends the CRON_SECRET as a Bearer token if set).
 * @param res Vercel response — JSON `{ week, inserted }` on success.
 * @returns Nothing; writes the HTTP response directly.
 * @sideEffect Inserts rows into the `weekly_plan` table.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only accept requests from Vercel Cron when a secret is configured.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    res.status(401).send('Unauthorized');
    return;
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const [
    { data: contacts, error: contactsError },
    { data: settings, error: settingsError },
  ] = await Promise.all([
    supabase.from('contacts').select('*'),
    supabase.from('settings').select('*').eq('id', 1).single(),
  ]);

  if (contactsError || settingsError || !contacts || !settings) {
    console.error('cron: failed to load data', contactsError?.message, settingsError?.message);
    res.status(500).json({ error: 'Failed to load contacts or settings' });
    return;
  }

  const weekStart = getWeekStart();
  const weekKey = toISODate(weekStart);

  const { data: storedPlan, error: planError } = await supabase
    .from('weekly_plan')
    .select('contact_id, scheduled_date')
    .eq('week_start', weekKey);

  if (planError) {
    console.error('cron: failed to load weekly_plan', planError.message);
    res.status(500).json({ error: 'Failed to load weekly_plan' });
    return;
  }

  const existing = (storedPlan ?? []) as Array<{ contact_id: string; scheduled_date: string }>;
  const inserts = computePlanInserts(contacts as Contact[], settings as Settings, weekStart, existing);

  if (inserts.length > 0) {
    const { error: insertError } = await supabase.from('weekly_plan').insert(inserts);
    if (insertError) {
      console.error('cron: weekly_plan insert failed', insertError.message);
      res.status(500).json({ error: 'Failed to insert weekly_plan rows' });
      return;
    }
  }

  console.log(`cron: week ${weekKey} — inserted ${inserts.length} row(s)`);
  res.status(200).json({ week: weekKey, inserted: inserts.length });
}
