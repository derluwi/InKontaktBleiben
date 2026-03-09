import { useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/lib/supabase';
import type { Settings } from '@/types';

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    supabase.from('settings').select('*').eq('id', 1).single().then(({ data }) => {
      if (data) setSettings(data as Settings);
    });
  }, []);

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    await supabase.from('settings').update(settings).eq('id', 1);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function update(patch: Partial<Settings>) {
    setSettings((s) => s ? { ...s, ...patch } : s);
  }

  async function copyCalendarUrl() {
    const url = `${window.location.origin}/api/calendar?token=${settings?.calendar_token}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!settings) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground">Lädt…</div>;
  }

  const calendarUrl = `${window.location.origin}/api/calendar?token=${settings.calendar_token}`;

  return (
    <div className="max-w-lg mx-auto">
      {/* Header */}
      <div className="sticky top-0 bg-background/95 backdrop-blur-sm border-b px-4 py-3 flex items-center justify-between z-10">
        <h1 className="text-lg font-semibold">Einstellungen</h1>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saved ? <><Check className="h-4 w-4 mr-1" /> Gespeichert</> : saving ? 'Speichern…' : 'Speichern'}
        </Button>
      </div>

      <div className="px-4 py-4 space-y-6">

        {/* Planung */}
        <section className="space-y-3">
          <h2 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Planung</h2>

          <div className="flex items-center justify-between">
            <Label htmlFor="maxCalls">Max. Anrufe pro Woche</Label>
            <Input
              id="maxCalls"
              type="number"
              min={1}
              max={20}
              className="w-20 text-center"
              value={settings.max_calls_per_week}
              onChange={(e) => update({ max_calls_per_week: parseInt(e.target.value) || 1 })}
            />
          </div>
        </section>

        <Separator />

        {/* Uhrzeiten beruflich */}
        <section className="space-y-3">
          <h2 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">💼 Berufliche Anrufe</h2>

          <div className="flex items-center justify-between">
            <Label htmlFor="workTime">Uhrzeit (Mo–Fr)</Label>
            <Input
              id="workTime"
              type="time"
              className="w-28"
              value={settings.work_call_time}
              onChange={(e) => update({ work_call_time: e.target.value })}
            />
          </div>
        </section>

        <Separator />

        {/* Uhrzeiten privat */}
        <section className="space-y-3">
          <h2 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">👤 Private Anrufe</h2>

          <div className="flex items-center justify-between">
            <div>
              <Label>Wochentags abends</Label>
              <p className="text-xs text-muted-foreground">Mo–Fr</p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="time"
                className="w-28"
                value={settings.private_weekday_time}
                onChange={(e) => update({ private_weekday_time: e.target.value })}
                disabled={!settings.allow_private_weekday_evening}
              />
              <Switch
                checked={settings.allow_private_weekday_evening}
                onCheckedChange={(v) => update({ allow_private_weekday_evening: v })}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Wochenende</Label>
              <p className="text-xs text-muted-foreground">Sa–So</p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="time"
                className="w-28"
                value={settings.private_weekend_time}
                onChange={(e) => update({ private_weekend_time: e.target.value })}
                disabled={!settings.allow_private_weekend}
              />
              <Switch
                checked={settings.allow_private_weekend}
                onCheckedChange={(v) => update({ allow_private_weekend: v })}
              />
            </div>
          </div>
        </section>

        <Separator />

        {/* Kalender-Abo */}
        <section className="space-y-3">
          <h2 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Kalender-Abo</h2>

          <div className="space-y-2">
            <Label>Abo-URL für Apple Kalender</Label>
            <div className="flex gap-2">
              <Input value={calendarUrl} readOnly className="text-xs" />
              <Button variant="outline" size="icon" onClick={copyCalendarUrl}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="rounded-lg border bg-muted/40 p-4 space-y-2 text-sm">
            <p className="font-medium">So trägst du die URL in Apple Kalender ein:</p>
            <ol className="space-y-1.5 text-muted-foreground list-decimal list-inside">
              <li>Öffne <strong>Apple Kalender</strong> auf deinem iPhone</li>
              <li>Tippe unten auf <strong>Kalender</strong></li>
              <li>Tippe oben links auf <strong>Hinzufügen</strong> (oder <strong>+</strong>)</li>
              <li>Wähle <strong>„Kalenderabonnement hinzufügen"</strong></li>
              <li>Füge die obige URL ein und tippe auf <strong>Abonnieren</strong></li>
              <li>Apple Kalender fragt automatisch regelmäßig nach Updates</li>
            </ol>
          </div>
        </section>

      </div>
    </div>
  );
}
