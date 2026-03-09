import { useEffect, useState } from 'react';
import { BookUser } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { Contact, ContactType, Frequency } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (data: Omit<Contact, 'id' | 'created_at'>) => Promise<void>;
  initial?: Contact | null;
}

const defaultForm = {
  name: '',
  type: 'beruflich' as ContactType,
  frequency: 'monatlich' as Frequency,
  phone: '',
  notes: '',
  last_called_at: '',
};

export default function ContactForm({ open, onClose, onSave, initial }: Props) {
  const [form, setForm] = useState(() =>
    initial
      ? {
          name: initial.name,
          type: initial.type,
          frequency: initial.frequency,
          phone: initial.phone ?? '',
          notes: initial.notes ?? '',
          last_called_at: initial.last_called_at ?? '',
        }
      : defaultForm,
  );
  const [saving, setSaving] = useState(false);
  const supportsContactPicker = !!navigator.contacts?.select;

  async function handleImportContact() {
    if (!navigator.contacts) return;
    try {
      const results = await navigator.contacts.select(['name', 'tel'], { multiple: false });
      if (!results.length) return;
      const picked = results[0];
      const name = picked.name?.[0]?.trim() ?? '';
      const phone = picked.tel?.[0]?.trim() ?? '';
      setForm((prev) => ({
        ...prev,
        ...(name && { name }),
        ...(phone && { phone }),
      }));
    } catch {
      // User cancelled — do nothing
    }
  }

  // Sync form when switching between contacts (edit) or opening a new form
  useEffect(() => {
    setForm(
      initial
        ? {
            name: initial.name,
            type: initial.type,
            frequency: initial.frequency,
            phone: initial.phone ?? '',
            notes: initial.notes ?? '',
            last_called_at: initial.last_called_at ?? '',
          }
        : defaultForm,
    );
  }, [initial]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    await onSave({
      name: form.name.trim(),
      type: form.type,
      frequency: form.frequency,
      phone: form.phone.trim() || undefined,
      notes: form.notes.trim() || undefined,
      last_called_at: form.last_called_at || undefined,
    });
    setSaving(false);
    setForm(defaultForm);
    onClose();
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90svh] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>{initial ? 'Kontakt bearbeiten' : 'Neuer Kontakt'}</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {supportsContactPicker && (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleImportContact}
            >
              <BookUser className="h-4 w-4 mr-2" />
              Aus Kontakten importieren
            </Button>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Max Mustermann"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>Typ</Label>
            <Select
              value={form.type}
              onValueChange={(v) => setForm({ ...form, type: v as ContactType })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="beruflich">💼 Beruflich</SelectItem>
                <SelectItem value="privat">👤 Privat</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Frequenz</Label>
            <Select
              value={form.frequency}
              onValueChange={(v) => setForm({ ...form, frequency: v as Frequency })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="wöchentlich">Wöchentlich</SelectItem>
                <SelectItem value="zweiwöchentlich">Zweiwöchentlich</SelectItem>
                <SelectItem value="monatlich">Monatlich</SelectItem>
                <SelectItem value="quartalsweise">Quartalsweise</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone">Telefonnummer</Label>
            <Input
              id="phone"
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+49 170 1234567"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="last_called">Zuletzt angerufen</Label>
            <Input
              id="last_called"
              type="date"
              value={form.last_called_at}
              onChange={(e) => setForm({ ...form, last_called_at: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Bemerkung</Label>
            <Textarea
              id="notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Notizen zum Kontakt..."
              rows={3}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Abbrechen
            </Button>
            <Button type="submit" className="flex-1" disabled={saving}>
              {saving ? 'Speichern…' : 'Speichern'}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
