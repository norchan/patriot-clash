-- SOLAR ARRAY + REPAIR SYSTEM (Michael 2026-08-09): a second income building,
-- and raided bases now carry real scars — buildings get a repair countdown
-- (auto-heal when it lapses) or an instant FP repair. The Doberman guard dog
-- is deliberately ABSENT here: it never dies and needs no state — full health
-- every raid, by design.

alter table public.house_buildings
  add column if not exists damaged_until timestamptz;

-- Generic claim for income buildings (media tower, solar array, whatever
-- comes next). Same shape as claim_media_tower, plus: a damaged building
-- produces nothing until repaired.
create or replace function public.claim_income_building(
  p_profile_id uuid, p_type text, p_rates integer[],
  p_interval_secs integer, p_bank_intervals integer, p_desc text
) returns integer
language plpgsql security definer as $$
declare
  v_b record;
  v_intervals integer;
  v_amount integer;
begin
  select * into v_b from public.house_buildings
   where profile_id = p_profile_id and type = p_type
   for update;
  if not found then return 0; end if;
  if v_b.damaged_until is not null and v_b.damaged_until > now() then return 0; end if;

  v_intervals := least(p_bank_intervals,
    floor(extract(epoch from (now() - v_b.claimed_at)) / p_interval_secs)::integer);
  if v_intervals <= 0 then return 0; end if;

  v_amount := v_intervals * coalesce(p_rates[v_b.level], 0);
  if v_amount <= 0 then return 0; end if;

  update public.house_buildings
     set claimed_at = claimed_at + (v_intervals * p_interval_secs || ' seconds')::interval
   where id = v_b.id;

  perform public.grant_fp(p_profile_id, v_amount, 'house_income'::transaction_type,
    null, 'house', p_desc);
  return v_amount;
end;
$$;

-- After a raid lands, the defender's buildings are DAMAGED: repair countdown
-- scales with level; fences are quicker than buildings. The doberman is
-- exempt — it never dies. Auto-heal is implicit: damaged means
-- damaged_until > now(), so the countdown lapsing IS the repair.
create or replace function public.damage_base(
  p_profile_id uuid, p_fence_secs_per_level integer, p_building_secs_per_level integer
) returns void
language plpgsql security definer as $$
begin
  update public.house_buildings
     set damaged_until = now() + make_interval(secs =>
       case when type = 'fence' then p_fence_secs_per_level * level
            else p_building_secs_per_level * level end)
   where profile_id = p_profile_id
     and type <> 'doberman';
end;
$$;

-- Instant repair: pay (API quotes from remaining time, same rush shape as
-- upgrades), damage cleared. Atomic spend+clear.
create or replace function public.repair_building(
  p_profile_id uuid, p_pad smallint, p_cost integer
) returns void
language plpgsql security definer as $$
declare
  v_b record;
begin
  select * into v_b from public.house_buildings
   where profile_id = p_profile_id and pad = p_pad
   for update;
  if not found then raise exception 'REPAIR_NOTHING'; end if;
  if v_b.damaged_until is null or v_b.damaged_until <= now() then
    raise exception 'REPAIR_NOT_NEEDED';
  end if;
  if p_cost > 0 then
    perform public.spend_fp(p_profile_id, p_cost, 'house_build'::transaction_type,
      null, 'house', 'Repaired ' || v_b.type);
  end if;
  update public.house_buildings set damaged_until = null where id = v_b.id;
end;
$$;
