import { useEffect, useState } from 'react';
import { Plus, Phone, Check, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import ContactForm from '@/components/ContactForm';
import { supabase } from '@/lib/supabase';
import { getDaysOverdue, getDueLabel, toISODate } from '@/lib/scheduling';
import type { Contact } from '@/types';

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [deleteContact, setDeleteContact] = useState<Contact | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [callingId, setCallingId] = useState<string | null>(null);
  const [editPressId, setEditPressId] = useState<string | null>(null);
  const [deletePressId, setDeletePressId] = useState<string | null>(null);
  const [exitingId, setExitingId] = useState<string | null>(null);

  const today = toISODate(new Date());

  async function loadContacts() {
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .order('name');
    if (error) {
      setLoadError('Kontakte konnten nicht geladen werden: ' + error.message);
    } else {
      setContacts(data ?? []);
      setLoadError(null);
    }
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadContacts(); }, []);

  async function handleSave(data: Omit<Contact, 'id' | 'created_at'>) {
    if (editContact) {
      const { error } = await supabase.from('contacts').update(data).eq('id', editContact.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from('contacts').insert(data);
      if (error) throw new Error(error.message);
    }
    setEditContact(null);
    await loadContacts();
  }

  async function handleDelete() {
    if (!deleteContact) return;
    const target = deleteContact;
    setDeleteContact(null);
    setExitingId(target.id);
    const { error } = await supabase.from('contacts').delete().eq('id', target.id);
    if (error) { alert('Fehler beim Löschen: ' + error.message); setExitingId(null); return; }
    setTimeout(() => { setExitingId(null); loadContacts(); }, 360);
  }

  async function markCalled(contact: Contact) {
    setCallingId(contact.id);
    const todayStr = toISODate(new Date());
    const { error } = await supabase.from('contacts').update({ last_called_at: todayStr }).eq('id', contact.id);
    if (error) { alert('Fehler: ' + error.message); setCallingId(null); return; }
    await supabase.from('weekly_plan').delete().eq('contact_id', contact.id).gte('scheduled_date', todayStr);
    setTimeout(() => { setCallingId(null); loadContacts(); }, 700);
  }

  function handleEditPress(contact: Contact) {
    setEditPressId(contact.id);
    setTimeout(() => {
      setEditPressId(null);
      setEditContact(contact);
      setFormOpen(true);
    }, 130);
  }

  function handleDeletePress(contact: Contact) {
    setDeletePressId(contact.id);
    setTimeout(() => {
      setDeletePressId(null);
      setDeleteContact(contact);
    }, 130);
  }

  const sortedContacts = [...contacts].sort((a, b) => {
    return getDaysOverdue(b) - getDaysOverdue(a);
  });

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground">Lädt…</div>;
  }

  if (loadError) {
    return <div className="flex items-center justify-center h-64 text-destructive px-4 text-center text-sm">{loadError}</div>;
  }

  return (
    <div className="max-w-lg mx-auto">
      {/* Header */}
      <div className="sticky top-0 bg-background/95 backdrop-blur-sm border-b px-4 py-3 flex items-center justify-between z-10">
        <h1 className="text-lg font-semibold">Kontakte</h1>
        <Button
          size="sm"
          onClick={() => { setEditContact(null); setFormOpen(true); }}
        >
          <Plus className="h-4 w-4 mr-1" />
          Neu
        </Button>
      </div>

      {contacts.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 h-64 text-muted-foreground px-8 text-center">
          <Users className="h-10 w-10 opacity-30" />
          <p>Noch keine Kontakte. Füge deinen ersten Kontakt hinzu!</p>
          <Button onClick={() => setFormOpen(true)}>Ersten Kontakt hinzufügen</Button>
        </div>
      ) : (
        <ul className="divide-y">
          {sortedContacts.map((contact) => {
            const overdue = getDaysOverdue(contact);
            const dueLabel = getDueLabel(contact);
            const isOverdue = overdue > 0;

            const isCalling = callingId === contact.id;
            const isExiting = exitingId === contact.id;

            return (
              <li
                key={contact.id}
                className={`px-4 py-3 flex items-center gap-3 transition-all duration-300 ${
                  isCalling ? 'bg-green-50 dark:bg-green-950/20' : ''
                } ${
                  isExiting ? 'opacity-0 -translate-x-1' : ''
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{contact.name}</span>
                    <Badge variant={contact.type === 'beruflich' ? 'secondary' : 'outline'} className="text-xs">
                      {contact.type === 'beruflich' ? '💼' : '👤'} {contact.type}
                    </Badge>
                  </div>
                  <div className="text-sm text-muted-foreground mt-0.5 flex gap-2 flex-wrap">
                    <span>{contact.frequency}</span>
                    <span className={isOverdue ? 'text-destructive font-medium' : ''}>
                      · {dueLabel}
                    </span>
                  </div>
                  {contact.notes && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{contact.notes}</p>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="outline"
                    size="icon"
                    className={`relative overflow-visible h-8 w-8 transition-colors ${
                      isCalling
                        ? 'border-green-500 bg-green-50 text-green-600 hover:text-green-600 dark:bg-green-950/30'
                        : contact.last_called_at === today
                          ? 'border-green-500 text-green-500 hover:text-green-500'
                          : ''
                    }`}
                    onClick={() => markCalled(contact)}
                    disabled={isCalling}
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
                  <Button
                    variant="outline"
                    size="icon"
                    className={`h-8 w-8 transition-all duration-100 ${
                      editPressId === contact.id ? 'scale-90 opacity-60' : ''
                    }`}
                    onClick={() => handleEditPress(contact)}
                    disabled={editPressId === contact.id}
                    title="Kontakt bearbeiten"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className={`relative overflow-visible h-8 w-8 text-destructive hover:text-destructive border-destructive/40 transition-all duration-100 ${
                      deletePressId === contact.id ? 'scale-90 opacity-60 bg-destructive/10' : ''
                    }`}
                    onClick={() => handleDeletePress(contact)}
                    disabled={deletePressId === contact.id}
                    title="Kontakt löschen"
                  >
                    {deletePressId === contact.id && (
                      <span
                        className="absolute inset-0 rounded-md bg-destructive/30 pointer-events-none"
                        style={{ animation: 'ping-once 0.38s ease-out forwards' }}
                      />
                    )}
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ContactForm
        key={editContact?.id ?? 'new'}
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditContact(null); }}
        onSave={handleSave}
        initial={editContact}
      />

      <Dialog open={!!deleteContact} onOpenChange={(v) => !v && setDeleteContact(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kontakt löschen?</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground">
            „{deleteContact?.name}" wird unwiderruflich gelöscht.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteContact(null)}>Abbrechen</Button>
            <Button variant="destructive" onClick={handleDelete}>Löschen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Users({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
