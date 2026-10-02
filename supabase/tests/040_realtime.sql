-- Realtime publication (02 §11, 04 §4): includes public.issues, and no other public table.
do $$ declare tables text[]; begin
  select array_agg(tablename order by tablename) into tables
  from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public';
  if tables is distinct from array['issues']::text[] then
    raise exception 'supabase_realtime should publish exactly public.issues, got %', tables;
  end if;
end $$;
