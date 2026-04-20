import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import type { Contact, Settings, ScheduledCall } from '../src/types/index';
import { scheduleWeek } from '../src/lib/scheduling';

// ─── Berlin-aware date helpers (Vercel runs in UTC) ───────────────────────────

/** Format date as YYYY-MM-DD in Europe/Berlin timezone */
function toISODate(date: Date): string {
  return date.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
}

/** Monday of the current week in Europe/Berlin timezone */
function getWeekStart(date: Date = new Date()): Date {
  const berlinDateStr = date.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  const [year, month, day] = berlinDateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return d;
}

// ─── ICS Generation ───────────────────────────────────────────────────────────

function escapeIcs(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/** Convert YYYY-MM-DD + HH:MM to ICS date-time string (local Berlin time, no UTC conversion) */
function toIcsDateTime(date: string, time: string): string {
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
      'BEGIN:VALARM',
      'TRIGGER:-PT1H',
      'ACTION:DISPLAY',
      `DESCRIPTION:In 1 Std: ${escapeIcs(contact.name)}`,
      'END:VALARM',
      'BEGIN:VALARM',
      'TRIGGER:-PT24H',
      'ACTION:DISPLAY',
      `DESCRIPTION:Morgen: ${escapeIcs(contact.name)}`,
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

  const { data: settings } = await supabase
    .from('settings')
    .select('*')
    .eq('id', 1)
    .single();

  if (!settings || settings.calendar_token !== token) {
    res.status(401).send('Unauthorized');
    return;
  }

  const weekStart = getWeekStart();
  const weekKey = toISODate(weekStart);

  if (settings.paused_weeks?.includes(weekKey)) {
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="kontakte.ics"');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.status(200).send(generateIcs([]));
    return;
  }

  let calls: ScheduledCall[];

  // Prefer the frozen weekly plan stored by the frontend
  const { data: storedPlan } = await supabase
    .from('weekly_plan')
    .select('scheduled_date, scheduled_time, contacts(*)')
    .eq('week_start', weekKey);

  if (storedPlan && storedPlan.length > 0) {
    calls = (storedPlan as unknown as Array<{ scheduled_date: string; scheduled_time: string; contacts: Contact }>)
      .map((p) => ({ contact: p.contacts, date: p.scheduled_date, time: p.scheduled_time }))
      .sort((a, b) => a.date.localeCompare(b.date));
  } else {
    // Fall back to live computation (e.g. ICS fetched before app was opened this week)
    const { data: contacts } = await supabase.from('contacts').select('*');
    if (!contacts) {
      res.status(500).send('Error loading contacts');
      return;
    }
    calls = scheduleWeek(contacts as Contact[], settings as Settings, weekStart);
  }

  const ics = generateIcs(calls);

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="kontakte.ics"');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.status(200).send(ics);
}
