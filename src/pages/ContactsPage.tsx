import { useEffect, useState } from 'react';
import { Plus, Phone, Pencil, Trash2 } from 'lucide-react';
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
import { getDaysOverdue, getDueLabel } from '@/lib/scheduling';
import type { Contact } from '@/types';

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [deleteContact, setDeleteContact] = useState<Contact | null>(null);

  async function loadContacts() {
    const { data } = await supabase
      .from('contacts')
      .select('*')
      .order('name');
    if (data) setContacts(data);
    setLoading(false);
  }

  useEffect(() => { loadContacts(); }, []);

  async function handleSave(data: Omit<Contact, 'id' | 'created_at'>) {
    if (editContact) {
      await supabase.from('contacts').update(data).eq('id', editContact.id);
    } else {
      await supabase.from('contacts').insert(data);
    }
    setEditContact(null);
    await loadContacts();
  }

  async function handleDelete() {
    if (!deleteContact) return;
    await supabase.from('contacts').delete().eq('id', deleteContact.id);
    setDeleteContact(null);
    await loadContacts();
  }

  async function markCalled(contact: Contact) {
    const today = new Date().toISOString().split('T')[0];
    await supabase
      .from('contacts')
      .update({ last_called_at: today })
      .eq('id', contact.id);
    await loadContacts();
  }

  const sortedContacts = [...contacts].sort((a, b) => {
    return getDaysOverdue(b) - getDaysOverdue(a);
  });

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground">Lädt…</div>;
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

            return (
              <li key={contact.id} className="px-4 py-3 flex items-center gap-3">
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
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => markCalled(contact)}
                    title="Als angerufen markieren"
                  >
                    <Phone className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => { setEditContact(contact); setFormOpen(true); }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => setDeleteContact(contact)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ContactForm
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
