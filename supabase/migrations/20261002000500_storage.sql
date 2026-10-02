-- CivicPulse AI — Phase 0: storage buckets and policies (02 §10.2).
-- Public read; re-encoded JPEG only (02 §10.1); 2 MB limit. Object path: {uid}/{uuid}.jpg.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('report-photos',     'report-photos',     true, 2097152, array['image/jpeg']),
  ('resolution-photos', 'resolution-photos', true, 2097152, array['image/jpeg'])
on conflict (id) do update set
  name               = excluded.name,
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- report-photos: any authenticated user (citizens are anonymous auth users), own folder only.
create policy "report-photos: insert own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'report-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- resolution-photos: authority only, own folder only.
create policy "resolution-photos: authority insert own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'resolution-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_authority((select auth.uid())))
  );

-- Public buckets serve reads without a policy; this one lets the client upload read its row back
-- (INSERT ... RETURNING needs a passing SELECT policy).
create policy "civicpulse photos: public read" on storage.objects
  for select to anon, authenticated
  using (bucket_id in ('report-photos', 'resolution-photos'));

-- No UPDATE or DELETE policies: uploaded photos are kept for audit (02 §10.3).
