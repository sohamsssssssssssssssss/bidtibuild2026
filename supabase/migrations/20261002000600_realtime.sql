-- CivicPulse AI — Phase 0: Realtime (02 §11, 04 §4).
-- Only `issues` is published; subscribers receive rows allowed by the issues SELECT policy.
alter publication supabase_realtime add table public.issues;
