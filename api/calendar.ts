import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// ─── Types (duplicated for the serverless context) ───────────────────────────

type ContactType = 'beruflich' | 'privat';
type Frequency = 'wöchentlich' | 'zweiwöchentlich' | 'monatlich' | 'quartalsweise';

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

// ─── Scheduling (same logic as src/lib/scheduling.ts) ────────────────────────

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

/** Format date as YYYY-MM-DD in Europe/Berlin timezone (Vercel runs in UTC) */
function toISODate(date: Date): string {
  // sv-SE locale uses YYYY-MM-DD format natively
  return date.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
}

function getWeekStart(date: Date = new Date()): Date {
  // Parse current date in Berlin timezone
  const berlinDateStr = date.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  const [year, month, day] = berlinDateStr.split('-').map(Number);
  // Create a Date at midnight local (Node UTC) representing the Berlin date
  const d = new Date(year, month - 1, day);
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return d;
}

function getTargetDate(contact: Contact): Date {
  if (!contact.last_called_at) return new Date(contact.created_at);
  const lastCalled = new Date(contact.last_called_at);
  return addDays(lastCalled, FREQUENCY_DAYS[contact.frequency] ?? 30);
}

function getDaysOverdue(contact: Contact, referenceDate: Date): number {
  const target = getTargetDate(contact);
  return Math.floor((referenceDate.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));
}

function scheduleWeek(contacts: Contact[], settings: Settings, weekStart: Date): ScheduledCall[] {
  const weekKey = toISODate(weekStart);
  if (settings.paused_weeks?.includes(weekKey)) return [];

  const sorted = [...contacts].sort((a, b) => {
    const aNew = !a.last_called_at;
    const bNew = !b.last_called_at;
    if (aNew && !bNew) return -1;
    if (!aNew && bNew) return 1;
    const aDue = getDaysOverdue(a, weekStart);
    const bDue = getDaysOverdue(b, weekStart);
    if (bDue !== aDue) return bDue - aDue;
    return a.id < b.id ? -1 : 1;
  });

  const selected = sorted.slice(0, settings.max_calls_per_week);

  const beruflichSlots = [0, 1, 2, 3, 4].map((i) => ({
    date: toISODate(addDays(weekStart, i)),
    time: settings.work_call_time,
  }));

  const privatSlots: { date: string; time: string }[] = [];
  if (settings.allow_private_weekend) {
    privatSlots.push(
      { date: toISODate(addDays(weekStart, 5)), time: settings.private_weekend_time },
      { date: toISODate(addDays(weekStart, 6)), time: settings.private_weekend_time },
    );
  }
  if (settings.allow_private_weekday_evening) {
    [0, 1, 2, 3, 4].forEach((i) => {
      privatSlots.push({ date: toISODate(addDays(weekStart, i)), time: settings.private_weekday_time });
    });
  }

  const result: ScheduledCall[] = [];
  let beruflichIdx = 0;
  let privatIdx = 0;

  for (const contact of selected) {
    if (contact.type === 'beruflich') {
      if (beruflichIdx < beruflichSlots.length) {
        result.push({ contact, ...beruflichSlots[beruflichIdx++] });
      }
    } else {
      if (privatIdx < privatSlots.length) {
        result.push({ contact, ...privatSlots[privatIdx++] });
      }
    }
  }
  return result;
}

// ─── ICS Generation ───────────────────────────────────────────────────────────

function escapeIcs(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/** Convert YYYY-MM-DD + HH:MM to ICS date-time string (local Berlin time, no UTC conversion) */
function toIcsDateTime(date: string, time: string): string {
  // Format: YYYYMMDDTHHMMSS
  const [year, month, day] = date.split('-');
  const [hour, minute] = time.split(':');
  return `${year}${month}${day}T${hour}${minute}00`;
}

function generateIcs(calls: ScheduledCall[]): string {
  const events = calls.map(({ contact, date, time }) => {
    const dtStart = toIcsDateTime(date, time);
    // 30-minute slot
    const [h, m] = time.split(':').map(Number);
    const endMinutes = m + 30;
    const endHour = h + Math.floor(endMinutes / 60);
    const endMin = endMinutes % 60;
    const endTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;
    const dtEnd = toIcsDateTime(date, endTime);

    const uid = `${contact.id}-${date}@inkontaktbleiben`;
    const summary = `Anruf: ${escapeIcs(contact.name)}`;
    const description = contact.phone
      ? `tel:${escapeIcs(contact.phone)}`
      : escapeIcs(contact.name);

    return [
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTART;TZID=Europe/Berlin:${dtStart}`,
      `DTEND;TZID=Europe/Berlin:${dtEnd}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${description}`,
      'BEGIN:VALARM',
      'TRIGGER:-PT10M',
      'ACTION:DISPLAY',
      `DESCRIPTION:In 10 Min: ${escapeIcs(contact.name)}`,
      'END:VALARM',
      'END:VEVENT',
    ].join('\r\n');
  });

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//In Kontakt Bleiben//DE',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Kontakt-Anrufe',
    'X-WR-TIMEZONE:Europe/Berlin',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { token } = req.query;

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Validate token
  const { data: settings } = await supabase
    .from('settings')
    .select('*')
    .eq('id', 1)
    .single();

  if (!settings || settings.calendar_token !== token) {
    res.status(401).send('Unauthorized');
    return;
  }

  const { data: contacts } = await supabase.from('contacts').select('*');
  if (!contacts) {
    res.status(500).send('Error loading contacts');
    return;
  }

  const weekStart = getWeekStart();
  const calls = scheduleWeek(contacts as Contact[], settings as Settings, weekStart);
  const ics = generateIcs(calls);

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="kontakte.ics"');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.status(200).send(ics);
}
