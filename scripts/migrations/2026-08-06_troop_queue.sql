-- TROOP TRAINING QUEUE (Michael 2026-08-06): "there should be a timer and a
-- queue for building the troops... queue up the limit... each troop should
-- take some time to build... pay to have them built right away with fp."
--
-- Same lazy-settlement pattern as house upgrades: no cron — troops_settle()
-- runs before every read/mutation and pops whatever finished while the player
-- was away. FP is paid at ENQUEUE time (spend_fp inside the same transaction);
-- the queue trains sequentially, one unit at a time; rows complete partially
-- (count decrements as units finish). Army cap is enforced against
-- troops + queued at enqueue, and troops only ever DECREASE afterwards
-- (casualties), so a completed queue can never overflow the cap.

create table if not exists public.house_troop_queue (
  id bigserial primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  troop_type text not null,
  count integer not null check (count > 0),
  secs_each integer not null check (secs_each > 0),
  cost_each integer not null default 0,
  started_at timestamptz,          -- set when this row reaches the head
  queued_at timestamptz not null default now()
);
create index if not exists house_troop_queue_profile on public.house_troop_queue (profile_id, id);

-- Pop everything that finished. Advisory-locked per profile so concurrent
-- settles/queues/rushes serialize.
create or replace function public.troops_settle(p_profile_id uuid)
returns void
language plpgsql security definer as $$
declare
  r record;
  v_elapsed numeric;
  v_done integer;
  v_finish timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('house_troops' || p_profile_id::text));
  loop
    select * into r from public.house_troop_queue
      where profile_id = p_profile_id order by id limit 1 for update;
    if not found then return; end if;
    if r.started_at is null then
      -- predecessor popped in an earlier loop pass sets started_at; a null
      -- here means this row became head while we hold the lock — start now
      update public.house_troop_queue set started_at = now() where id = r.id;
      return;
    end if;
    v_elapsed := extract(epoch from (now() - r.started_at));
    v_done := least(r.count, floor(v_elapsed / r.secs_each)::integer);
    if v_done <= 0 then return; end if;
    insert into public.house_troops (profile_id, troop_type, count)
    values (p_profile_id, r.troop_type, v_done)
    on conflict (profile_id, troop_type)
    do update set count = public.house_troops.count + excluded.count;
    if v_done >= r.count then
      v_finish := r.started_at + (r.count * r.secs_each) * interval '1 second';
      delete from public.house_troop_queue where id = r.id;
      update public.house_troop_queue set started_at = v_finish
        where id = (select min(id) from public.house_troop_queue where profile_id = p_profile_id);
      -- keep looping: the next row may ALSO already be done
    else
      update public.house_troop_queue
        set count = count - v_done,
            started_at = started_at + (v_done * r.secs_each) * interval '1 second'
        where id = r.id;
      return;
    end if;
  end loop;
end;
$$;

-- Enqueue: settle, cap-check (army + queue + new), pay, insert — one transaction.
create or replace function public.queue_troops(
  p_profile_id uuid, p_troop_type text, p_count integer,
  p_cost_each integer, p_secs_each integer, p_army_cap integer
) returns void
language plpgsql security definer as $$
declare
  v_army integer;
  v_queued integer;
begin
  if p_count is null or p_count <= 0 or p_count > 50 then
    raise exception 'BAD_COUNT';
  end if;
  perform public.troops_settle(p_profile_id);
  -- settle took the advisory lock in THIS transaction; still held here
  select coalesce(sum(count), 0) into v_army from public.house_troops where profile_id = p_profile_id;
  select coalesce(sum(count), 0) into v_queued from public.house_troop_queue where profile_id = p_profile_id;
  if v_army + v_queued + p_count > p_army_cap then
    raise exception 'ARMY_CAP';
  end if;
  perform public.spend_fp(p_profile_id, p_cost_each * p_count, 'house_build'::transaction_type,
    null, 'troops', 'Queued ' || p_count || ' ' || p_troop_type);
  insert into public.house_troop_queue (profile_id, troop_type, count, secs_each, cost_each, started_at)
  values (p_profile_id, p_troop_type, p_count, p_secs_each, p_cost_each,
    case when v_queued = 0 then now() else null end);
end;
$$;

-- Rush: finish the WHOLE queue now. Price = 40% of the remaining VALUE
-- (unstarted units full, the in-progress unit by its remaining fraction),
-- floor 5 FP — same shape as building rushes. Recomputed HERE, never trusted
-- from the client.
create or replace function public.rush_troop_queue(p_profile_id uuid)
returns integer
language plpgsql security definer as $$
declare
  r record;
  v_cost numeric := 0;
  v_frac numeric;
  v_spent integer;
begin
  perform public.troops_settle(p_profile_id);
  for r in select * from public.house_troop_queue
    where profile_id = p_profile_id order by id for update
  loop
    if r.started_at is not null then
      v_frac := 1 - least(1, greatest(0, extract(epoch from (now() - r.started_at)) / r.secs_each));
      v_cost := v_cost + r.cost_each * (r.count - 1 + v_frac);
    else
      v_cost := v_cost + r.cost_each * r.count;
    end if;
  end loop;
  if v_cost = 0 then raise exception 'QUEUE_EMPTY'; end if;
  v_spent := greatest(5, ceil(v_cost * 0.4)::integer);
  perform public.spend_fp(p_profile_id, v_spent, 'house_build'::transaction_type,
    null, 'troops', 'Rushed troop queue');
  insert into public.house_troops (profile_id, troop_type, count)
  select p_profile_id, troop_type, sum(count) from public.house_troop_queue
    where profile_id = p_profile_id group by troop_type
  on conflict (profile_id, troop_type)
  do update set count = public.house_troops.count + excluded.count;
  delete from public.house_troop_queue where profile_id = p_profile_id;
  return v_spent;
end;
$$;
