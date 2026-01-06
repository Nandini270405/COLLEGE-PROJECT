-- Enable RLS and create demo policies for public (anon) access
-- WARNING: These policies allow anonymous INSERT and SELECT access.
-- Use only for local/dev/demo. Tighten policies for production.

/* Enable row level security on the table */
ALTER TABLE public.mood_logs ENABLE ROW LEVEL SECURITY;

/* Allow anonymous (anon) role to SELECT rows */
CREATE POLICY anon_select ON public.mood_logs
  FOR SELECT
  TO anon
  USING (true);

/* Allow anonymous (anon) role to INSERT rows */
CREATE POLICY anon_insert ON public.mood_logs
  FOR INSERT
  TO anon
  WITH CHECK (true);

/* Optional: allow anon to UPDATE only their own rows (if you have user_id field)
   Uncomment and adapt if you add authenticated user handling
CREATE POLICY anon_update_own ON public.mood_logs
  FOR UPDATE
  TO anon
  USING (user_id = current_setting('request.jwt.claims', true)::json->> 'sub')
  WITH CHECK (user_id = current_setting('request.jwt.claims', true)::json->> 'sub');
*/

-- Done. Paste this into Supabase SQL Editor and run.
