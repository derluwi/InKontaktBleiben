import { useEffect, useState } from 'react';
import { Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { scheduleWeek, getWeekStart, toISODate } from '@/lib/scheduling';
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

  const weekStart = getWeekStart();
  const weekKey = toISODate(weekStart); // local timezone, not UTC

  async function load() {
    const [{ data: contacts }, { data: settingsData }] = await Promise.all([
      supabase.from('contacts').select('*'),
      supabase.from('settings').select('*').eq('id', 1).single(),
    ]);
    if (contacts && settingsData) {
      setSettings(settingsData as Settings);
      setSchedule(scheduleWeek(contacts as Contact[], settingsData as Settings, weekStart));
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function markCalled(contact: Contact) {
    const today = new Date().toISOString().split('T')[0];
    await supabase.from('contacts').update({ last_called_at: today }).eq('id', contact.id);
    await load();
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
          >
            {isPaused ? 'Pausiert ▶' : 'Pause ⏸'}
          </Button>
        </div>
      </div>

      {isPaused ? (
        <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
          <p className="text-2xl">⏸</p>
          <p>Diese Woche ist pausiert.</p>
          <Button variant="outline" size="sm" onClick={togglePause}>Pause aufheben</Button>
        </div>
      ) : schedule.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground px-8 text-center">
          <p>Keine Anrufe diese Woche geplant.</p>
          <p className="text-xs">Füge Kontakte hinzu oder erhöhe das Wochenlimit.</p>
        </div>
      ) : (
        <ul className="divide-y">
          {schedule.map(({ contact, date, time }) => {
            const dateLabel = formatDate(date);
            const isToday = date === toISODate(new Date());

            return (
              <li key={contact.id} className={`px-4 py-3 flex items-center gap-3 ${isToday ? 'bg-accent/40' : ''}`}>
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
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => markCalled(contact)}
                  title="Als angerufen markieren"
                >
                  <Phone className="h-4 w-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
