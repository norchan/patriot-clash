-- SECURITY P0 (Grok review 2026-08-12): every public-schema function granted
-- EXECUTE to PUBLIC/anon/authenticated by Postgres defaults — the shipped
-- anon key could call grant_fp/spend_fp/raid_house/etc. directly via
-- PostgREST. The app only ever calls RPCs through the service-role server
-- client, so: revoke from PUBLIC/anon/authenticated on EVERY function
-- (owner postgres keeps rights → pg_cron jobs + triggers unaffected), grant
-- service_role explicitly, and flip the DEFAULT so future functions are born
-- locked.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- future functions created by postgres default to NO public execute
alter default privileges in schema public revoke execute on functions from public;
