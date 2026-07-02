// Vercel runs functions in UTC. The shared scheduling logic in src/lib/scheduling.ts
// uses local-time date math (it was written for the user's browser, which is in Berlin).
// Assigning process.env.TZ makes Node call tzset(), so every Date operation below runs
// in Europe/Berlin — matching the browser exactly. For guaranteed correctness this is
// also set as a Vercel project env var (TZ=Europe/Berlin); this line covers `vercel dev`
// and acts as a belt-and-suspenders in case the env var is missing.
process.env.TZ = 'Europe/Berlin';

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { getWeekStart, toISODate, computePlanInserts } from '../src/lib/scheduling';
import type { Contact, Settings } from '../src/types';

/**
 * Daily cron job: ensures the current week's plan is frozen in `weekly_plan`.
 *
 * This decouples plan-freezing from a human opening the app. Previously the plan was
 * only written when WeeklyViewPage loaded; if the user never opened the app, the ICS
 * feed (which only reads the frozen plan) stayed empty — a vicious cycle. Running this
 * daily means the week is always frozen, and it self-heals if a run is ever skipped.
 * It is idempotent: re-running only slots in contacts that have no entry yet.
 *
 * Scheduled via vercel.json (`crons`). Vercel authenticates cron requests with the
 * `CRON_SECRET` env var (Authorization: Bearer <secret>) when it is configured.
 *
 * @param req Vercel request (cron sends the CRON_SECRET as a Bearer token if set).
 * @param res Vercel response — JSON `{ week, inserted }` on success.
 * @returns Nothing; writes the HTTP response directly.
 * @sideEffect Inserts rows into the `weekly_plan` table.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only accept requests from Vercel Cron when a secret is configured.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    res.status(401).send('Unauthorized');
    return;
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const [
    { data: contacts, error: contactsError },
    { data: settings, error: settingsError },
  ] = await Promise.all([
    supabase.from('contacts').select('*'),
    supabase.from('settings').select('*').eq('id', 1).single(),
  ]);

  if (contactsError || settingsError || !contacts || !settings) {
    console.error('cron: failed to load data', contactsError?.message, settingsError?.message);
    res.status(500).json({ error: 'Failed to load contacts or settings' });
    return;
  }

  const weekStart = getWeekStart();
  const weekKey = toISODate(weekStart);

  const { data: storedPlan, error: planError } = await supabase
    .from('weekly_plan')
    .select('contact_id, scheduled_date')
    .eq('week_start', weekKey);

  if (planError) {
    console.error('cron: failed to load weekly_plan', planError.message);
    res.status(500).json({ error: 'Failed to load weekly_plan' });
    return;
  }

  const existing = (storedPlan ?? []) as Array<{ contact_id: string; scheduled_date: string }>;
  const inserts = computePlanInserts(contacts as Contact[], settings as Settings, weekStart, existing);

  if (inserts.length > 0) {
    const { error: insertError } = await supabase.from('weekly_plan').insert(inserts);
    if (insertError) {
      console.error('cron: weekly_plan insert failed', insertError.message);
      res.status(500).json({ error: 'Failed to insert weekly_plan rows' });
      return;
    }
  }

  console.log(`cron: week ${weekKey} — inserted ${inserts.length} row(s)`);
  res.status(200).json({ week: weekKey, inserted: inserts.length });
}
