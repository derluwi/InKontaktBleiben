import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Contact {
  id: string;
  name: string;
  phone?: string;
}

interface StoredSettings {
  calendar_token: string;
  paused_weeks?: string[];
}

interface ScheduledCall {
  contact: Contact;
  date: string;
  time: string;
}

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

/** RFC 5545 §3.1: fold lines exceeding 75 octets */
function foldLine(line: string): string {
  const MAX = 75;
  if (line.length <= MAX) return line; // fast path: ASCII-only lines
  const encoder = new TextEncoder();
  const encoded = encoder.encode(line);
  if (encoded.length <= MAX) return line;

  const parts: string[] = [];
  let offset = 0;
  let isFirst = true;
  const decoder = new TextDecoder();

  while (offset < encoded.length) {
    const available = isFirst ? MAX : MAX - 1; // continuation line has 1-byte leading space
    let end = Math.min(offset + available, encoded.length);
    // Walk back to avoid splitting a multi-byte UTF-8 sequence
    while (end < encoded.length && (encoded[end] & 0xC0) === 0x80) end--;
    parts.push(decoder.decode(encoded.subarray(offset, end)));
    offset = end;
    isFirst = false;
  }

  return parts.join('\r\n ');
}

/** Convert YYYY-MM-DD + HH:MM to ICS date-time string (Europe/Berlin local time) */
function toIcsDateTime(date: string, time: string): string {
  const [year, month, day] = date.split('-');
  const [hour, minute] = time.split(':');
  return `${year}${month}${day}T${hour}${minute}00`;
}

const VTIMEZONE_BERLIN = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Berlin',
  'BEGIN:STANDARD',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
].join('\r\n');

function generateIcs(calls: ScheduledCall[]): string {
  const events = calls.map(({ contact, date, time }) => {
    const dtStart = toIcsDateTime(date, time);
    const [h, m] = time.split(':').map(Number);
    const endMinutes = m + 30;
    const endHour = h + Math.floor(endMinutes / 60);
    const endMin = endMinutes % 60;
    const endTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;
    const dtEnd = toIcsDateTime(date, endTime);
    const uid = `${contact.id}-${date}@inkontaktbleiben`;
    const name = escapeIcs(contact.name);

    return [
      'BEGIN:VEVENT',
      foldLine(`UID:${uid}`),
      `DTSTART;TZID=Europe/Berlin:${dtStart}`,
      `DTEND;TZID=Europe/Berlin:${dtEnd}`,
      foldLine(`SUMMARY:Anruf: ${name}`),
      foldLine(`DESCRIPTION:${contact.phone ? `tel:${escapeIcs(contact.phone)}` : name}`),
      'BEGIN:VALARM',
      'TRIGGER:-PT10M',
      'ACTION:DISPLAY',
      foldLine(`DESCRIPTION:In 10 Min: ${name}`),
      'END:VALARM',
      'BEGIN:VALARM',
      'TRIGGER:-PT1H',
      'ACTION:DISPLAY',
      foldLine(`DESCRIPTION:In 1 Std: ${name}`),
      'END:VALARM',
      'BEGIN:VALARM',
      'TRIGGER:-PT24H',
      'ACTION:DISPLAY',
      foldLine(`DESCRIPTION:Morgen: ${name}`),
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
    VTIMEZONE_BERLIN,
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
    .select('calendar_token, paused_weeks')
    .eq('id', 1)
    .single<StoredSettings>();

  if (!settings || settings.calendar_token !== token) {
    res.status(401).send('Unauthorized');
    return;
  }

  const weekStart = getWeekStart();
  const weekKey = toISODate(weekStart);

  if ((settings.paused_weeks ?? []).includes(weekKey)) {
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="kontakte.ics"');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.status(200).send(generateIcs([]));
    return;
  }

  const { data: storedPlan } = await supabase
    .from('weekly_plan')
    .select('scheduled_date, scheduled_time, contacts(id, name, phone)')
    .eq('week_start', weekKey);

  const calls: ScheduledCall[] = storedPlan
    ? (storedPlan as unknown as Array<{
        scheduled_date: string;
        scheduled_time: string;
        contacts: Contact | null;
      }>)
        .filter((p) => p.contacts != null)
        .map((p) => ({ contact: p.contacts!, date: p.scheduled_date, time: p.scheduled_time }))
        .sort((a, b) => a.date.localeCompare(b.date))
    : [];

  const ics = generateIcs(calls);

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="kontakte.ics"');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.status(200).send(ics);
}
