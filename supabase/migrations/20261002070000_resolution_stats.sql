-- CivicPulse AI — resolution time per category (GET /api/stats/resolution, 02 §13).
--
-- resolution_stats(p_config) — read only. p_config = RESOLUTION_STATS_CONFIG (src/config/civic.ts):
--   window_days    issues resolved (resolved_at) within this many days are measured
--   open_statuses  statuses counted as open right now
-- Returns {window_days, generated_at, categories: [...]}, one element per issue_category value in enum
-- order (categories with no data included): category, resolved_count, avg_resolution_hours and
-- median_resolution_hours (resolved_at - created_at, 1 decimal, null when nothing was resolved),
-- demo_resolved_count (how many of those are is_seed, 06 rule 2), open_count.
-- Counts only: no issue or reporter ids. A missing/invalid config key is a programming error: 22023.
create function public.resolution_stats(p_config jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_window_days int;
  v_open public.issue_status[];
  v_now timestamptz := now();
begin
  if p_config is null
     or jsonb_typeof(p_config -> 'window_days') is distinct from 'number'
     or jsonb_typeof(p_config -> 'open_statuses') is distinct from 'array' then
    raise exception 'p_config needs window_days (number) and open_statuses (array)' using errcode = '22023';
  end if;
  v_window_days := (p_config ->> 'window_days')::int;
  if v_window_days <= 0 then
    raise exception 'p_config.window_days must be positive' using errcode = '22023';
  end if;
  v_open := array(select jsonb_array_elements_text(p_config -> 'open_statuses'))::public.issue_status[];

  return jsonb_build_object(
    'window_days', v_window_days,
    'generated_at', v_now,
    'categories', (
      select jsonb_agg(
               jsonb_build_object(
                 'category', c.category,
                 'resolved_count', coalesce(r.resolved_count, 0),
                 'avg_resolution_hours', round(r.avg_hours::numeric, 1),
                 'median_resolution_hours', round(r.median_hours::numeric, 1),
                 'demo_resolved_count', coalesce(r.demo_count, 0),
                 'open_count', coalesce(o.open_count, 0)
               )
               order by c.ord)
      from unnest(enum_range(null::public.issue_category)) with ordinality as c(category, ord)
      left join (
        select i.category,
               count(*) as resolved_count,
               avg(extract(epoch from i.resolved_at - i.created_at) / 3600) as avg_hours,
               percentile_cont(0.5) within group (order by extract(epoch from i.resolved_at - i.created_at) / 3600)
                 as median_hours,
               count(*) filter (where i.is_seed) as demo_count
        from public.issues i
        where i.status = 'RESOLVED'
          and i.resolved_at > v_now - make_interval(days => v_window_days)
        group by i.category
      ) r on r.category = c.category
      left join (
        select i.category, count(*) as open_count
        from public.issues i
        where i.status = any(v_open)
        group by i.category
      ) o on o.category = c.category
    )
  );
end;
$$;

revoke all on function public.resolution_stats(jsonb) from public, anon, authenticated;
grant execute on function public.resolution_stats(jsonb) to service_role;
