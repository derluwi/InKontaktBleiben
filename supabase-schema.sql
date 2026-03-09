-- ============================================================
--  In Kontakt Bleiben — Supabase Datenbankschema
--  Dieses SQL im Supabase SQL-Editor ausführen
-- ============================================================

-- Kontakte
CREATE TABLE contacts (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT        NOT NULL,
  type        TEXT        NOT NULL CHECK (type IN ('beruflich', 'privat')),
  frequency   TEXT        NOT NULL CHECK (frequency IN ('wöchentlich', 'zweiwöchentlich', 'monatlich', 'quartalsweise')),
  phone       TEXT,
  notes       TEXT,
  last_called_at DATE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Einstellungen (immer genau eine Zeile mit id=1)
CREATE TABLE settings (
  id                           INTEGER     PRIMARY KEY DEFAULT 1,
  max_calls_per_week           INTEGER     NOT NULL DEFAULT 5,
  work_call_time               TEXT        NOT NULL DEFAULT '11:00',
  private_weekday_time         TEXT        NOT NULL DEFAULT '19:00',
  private_weekend_time         TEXT        NOT NULL DEFAULT '11:00',
  allow_private_weekday_evening BOOLEAN    NOT NULL DEFAULT TRUE,
  allow_private_weekend        BOOLEAN     NOT NULL DEFAULT TRUE,
  paused_weeks                 JSONB       NOT NULL DEFAULT '[]',
  calendar_token               TEXT        NOT NULL DEFAULT gen_random_uuid()::TEXT
);

-- Einstellungs-Zeile anlegen
INSERT INTO settings (id) VALUES (1);

-- ============================================================
--  Row Level Security (RLS) — für persönliche Nutzung einfach halten
--  HINWEIS: Für eine Single-User-App ohne Auth ist es OK,
--  RLS disabled zu lassen. Alternativ kannst du Auth aktivieren.
-- ============================================================

-- RLS aktivieren (optional, empfohlen)
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Alle Operationen erlauben (für Single-User ohne Auth)
-- ACHTUNG: Das macht die Daten über den Anon Key öffentlich lesbar!
-- Für einen privaten Einsatz ist das OK, solange du die URL nicht teilst.
CREATE POLICY "Allow all for anon" ON contacts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON settings FOR ALL USING (true) WITH CHECK (true);
