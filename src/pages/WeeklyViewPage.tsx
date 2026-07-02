import { useEffect, useState } from 'react';
import { Phone, Check, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { getWeekStart, toISODate, computePlanInserts } from '@/lib/scheduling';
import type { Contact, Settings, ScheduledCall } from '@/types';

const DAY_NAMES = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const DAY_NAMES_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

function formatDate(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00');
  return `${DAY_NAMES_LONG[d.getDay() === 0 ? 6 : d.getDay() - 1]}, ${d.getDate()}.${d.getMonth() + 1}.`;
}

export default function WeeklyViewPage() {
  const [schedule, setSchedule] = useState<ScheduledCall[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [pausing, setPausing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [callingId, setCallingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [exitingId, setExitingId] = useState<string | null>(null);

  const weekStart = getWeekStart();
  const weekKey = toISODate(weekStart); // local timezone, not UTC
  const today = toISODate(new Date());

  async function load() {
    const [
      { data: contacts, error: contactsError },
      { data: settingsData, error: settingsError },
      { data: storedPlan },
    ] = await Promise.all([
      supabase.from('contacts').select('*'),
      supabase.from('settings').select('*').eq('id', 1).single(),
      supabase.from('weekly_plan').select('*').eq('week_start', weekKey),
    ]);

    if (contactsError || settingsError || !contacts || !settingsData) {
      setLoadError('Daten konnten nicht geladen werden. Bitte Seite neu laden.');
      setLoading(false);
      return;
    }
    setLoadError(null);
    setSettings(settingsData as Settings);

    // Freeze the week (or slot in new contacts) via the shared scheduling logic —
    // the exact same computation the cron job runs headlessly. See computePlanInserts.
    const existing = (storedPlan ?? []) as Array<{ contact_id: string; scheduled_date: string; scheduled_time: string }>;
    const inserts = computePlanInserts(
      contacts as Contact[],
      settingsData as Settings,
      weekStart,
      existing,
    );
    if (inserts.length > 0) {
      const { error: insertError } = await supabase.from('weekly_plan').insert(inserts);
      if (insertError) console.error('weekly_plan insert failed:', insertError.message);
    }

    // Build the displayed schedule from stored rows + freshly inserted rows.
    const contactMap = new Map((contacts as Contact[]).map((c) => [c.id, c]));
    const schedule: ScheduledCall[] = [...existing, ...inserts]
      .map((p) => ({ contact: contactMap.get(p.contact_id)!, date: p.scheduled_date, time: p.scheduled_time }))
      .filter((s) => s.contact)
      .sort((a, b) => a.date.localeCompare(b.date));
    setSchedule(schedule);

    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  async function deleteSlot(contact: Contact) {
    setDeletingId(contact.id);
    await supabase.from('weekly_plan').delete().eq('week_start', weekKey).eq('contact_id', contact.id);
    setTimeout(() => setExitingId(contact.id), 320);
    setTimeout(() => { setDeletingId(null); setExitingId(null); load(); }, 680);
  }

  async function markCalled(contact: Contact) {
    setCallingId(contact.id);
    const todayStr = toISODate(new Date());
    const { error } = await supabase.from('contacts').update({ last_called_at: todayStr }).eq('id', contact.id);
    if (error) { alert('Fehler: ' + error.message); setCallingId(null); return; }
    // Delete all future slots for this contact (across all weeks), not just the current weekKey,
    // so stale frozen slots are always cleaned up after a call.
    await supabase.from('weekly_plan').delete().eq('contact_id', contact.id).gte('scheduled_date', todayStr);
    setTimeout(() => setExitingId(contact.id), 380);
    setTimeout(() => { setCallingId(null); setExitingId(null); load(); }, 730);
  }

  async function togglePause() {
    if (!settings) return;
    setPausing(true);
    const paused = settings.paused_weeks ?? [];
    const updated = paused.includes(weekKey)
      ? paused.filter((w) => w !== weekKey)
      : [...paused, weekKey];
    await supabase.from('settings').update({ paused_weeks: updated }).eq('id', 1);
    await load();
    setPausing(false);
  }

  const isPaused = settings?.paused_weeks?.includes(weekKey) ?? false;

  // Week range label
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekLabel = `${weekStart.getDate()}.${weekStart.getMonth() + 1}. – ${weekEnd.getDate()}.${weekEnd.getMonth() + 1}.${weekEnd.getFullYear()}`;

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground">Lädt…</div>;
  }

  if (loadError) {
    return <div className="flex items-center justify-center h-64 text-destructive px-4 text-center text-sm">{loadError}</div>;
  }

  return (
    <div className="max-w-lg mx-auto">
      {/* Header */}
      <div className="sticky top-0 bg-background/95 backdrop-blur-sm border-b px-4 py-3 z-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Diese Woche</h1>
            <p className="text-xs text-muted-foreground">{weekLabel}</p>
          </div>
          <Button
            size="sm"
            variant={isPaused ? 'default' : 'outline'}
            onClick={togglePause}
            disabled={pausing}
            title={isPaused ? 'Pause für diese Woche aufheben' : 'Keine Anrufe diese Woche einplanen'}
          >
            {isPaused ? 'Pausiert ▶' : 'Pause ⏸'}
          </Button>
        </div>
      </div>

      {isPaused ? (
        <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
          <p className="text-2xl">⏸</p>
          <p>Diese Woche ist pausiert.</p>
          <Button variant="outline" size="sm" onClick={togglePause} title="Pause für diese Woche aufheben">Pause aufheben</Button>
        </div>
      ) : schedule.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground px-8 text-center">
          <p>Keine Anrufe diese Woche geplant.</p>
          <p className="text-xs">Füge Kontakte hinzu oder erhöhe das Wochenlimit.</p>
        </div>
      ) : (
        <>
        <ul className="divide-y">
          {schedule.map(({ contact, date, time }) => {
            const dateLabel = formatDate(date);
            const isToday = date === toISODate(new Date());

            const isCalling = callingId === contact.id;
            const isDeleting = deletingId === contact.id;
            const isExiting = exitingId === contact.id;

            return (
              <li
                key={contact.id}
                className={`px-4 py-3 flex items-center gap-3 transition-all duration-300 ${
                  isToday && !isCalling && !isDeleting ? 'bg-accent/40' : ''
                } ${
                  isCalling ? 'bg-green-50 dark:bg-green-950/20' : ''
                } ${
                  isDeleting ? 'bg-red-50 dark:bg-red-950/20' : ''
                } ${
                  isExiting ? 'opacity-0 -translate-x-1' : ''
                }`}
              >
                <div className="text-center shrink-0 w-12">
                  <div className="text-xs text-muted-foreground">
                    {DAY_NAMES[new Date(date + 'T00:00:00').getDay() === 0 ? 6 : new Date(date + 'T00:00:00').getDay() - 1]}
                  </div>
                  <div className="text-sm font-medium">{time}</div>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{contact.name}</span>
                    <Badge variant={contact.type === 'beruflich' ? 'secondary' : 'outline'} className="text-xs shrink-0">
                      {contact.type === 'beruflich' ? '💼' : '👤'}
                    </Badge>
                    {isToday && <Badge className="text-xs shrink-0">Heute</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{dateLabel}</div>
                  {contact.phone && (
                    <a
                      href={`tel:${contact.phone}`}
                      className="text-xs text-primary mt-0.5 block"
                    >
                      {contact.phone}
                    </a>
                  )}
                </div>

                <Button
                  variant="outline"
                  size="icon"
                  className={`relative overflow-visible h-8 w-8 shrink-0 transition-colors ${
                    isDeleting
                      ? 'border-destructive/60 bg-red-50 text-destructive dark:bg-red-950/30'
                      : 'text-muted-foreground hover:text-destructive border-destructive/30'
                  }`}
                  onClick={() => deleteSlot(contact)}
                  disabled={isDeleting || isCalling}
                  title="Slot freigeben (Eintrag löschen)"
                >
                  {isDeleting && (
                    <span
                      className="absolute inset-0 rounded-md bg-destructive/30 pointer-events-none"
                      style={{ animation: 'ping-once 0.4s ease-out forwards' }}
                    />
                  )}
                  <Trash2 className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className={`relative overflow-visible h-8 w-8 shrink-0 transition-colors ${
                    isCalling
                      ? 'border-green-500 bg-green-50 text-green-600 hover:text-green-600 dark:bg-green-950/30'
                      : contact.last_called_at === today
                        ? 'border-green-500 text-green-500 hover:text-green-500'
                        : ''
                  }`}
                  onClick={() => markCalled(contact)}
                  disabled={isCalling || isDeleting}
                  title="Als angerufen markieren"
                >
                  {isCalling && (
                    <span
                      className="absolute inset-0 rounded-md bg-green-400/40 pointer-events-none"
                      style={{ animation: 'ping-once 0.42s ease-out forwards' }}
                    />
                  )}
                  {isCalling ? <Check className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
                </Button>
              </li>
            );
          })}
        </ul>
        {settings && settings.max_calls_per_week > schedule.length && (
          <div className="px-4 py-3 border-t text-xs text-muted-foreground italic">
            {settings.max_calls_per_week - schedule.length} Slot{settings.max_calls_per_week - schedule.length !== 1 ? 's' : ''} frei – niemand ist diese Woche fällig.
          </div>
        )}
        </>
      )}
    </div>
  );
}
