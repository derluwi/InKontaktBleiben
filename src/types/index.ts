export type ContactType = 'beruflich' | 'privat';

export type Frequency = 'wöchentlich' | 'zweiwöchentlich' | 'monatlich' | 'quartalsweise';

export interface Contact {
  id: string;
  name: string;
  type: ContactType;
  frequency: Frequency;
  phone?: string;
  notes?: string;
  last_called_at?: string; // ISO date string YYYY-MM-DD
  created_at: string;
}

export interface Settings {
  id: number;
  max_calls_per_week: number;
  work_call_time: string; // "HH:MM"
  private_weekday_time: string; // "HH:MM"
  private_weekend_time: string; // "HH:MM"
  allow_private_weekday_evening: boolean;
  allow_private_weekend: boolean;
  paused_weeks: string[]; // ISO date strings of week-Monday dates (YYYY-MM-DD)
  calendar_token: string; // secret token for ICS feed URL
}

export interface ScheduledCall {
  contact: Contact;
  date: string; // ISO date string YYYY-MM-DD
  time: string; // "HH:MM"
}
