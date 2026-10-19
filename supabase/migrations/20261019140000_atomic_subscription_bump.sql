-- Migration: Atomic increment of subscription charges_done and max_periods expiry enforcement
-- Prevents lost updates under concurrent reconciliations (audit-003 L11, closes #489)

create or replace function bump_subscription_charges_done(sub_id uuid)
returns table(charges_done integer, status text)
language plpgsql
security definer
as $$
declare
  current_charges integer;
  sub_max integer;
  new_charges integer;
  new_status text;
begin
  select s.charges_done, s.max_periods, s.status
  into current_charges, sub_max, new_status
  from subscriptions s
  where s.id = sub_id
  for update;

  if not found then
    return;
  end if;

  new_charges := coalesce(current_charges, 0) + 1;
  if sub_max is not null and new_charges >= sub_max then
    new_status := 'expired';
  end if;

  update subscriptions
  set charges_done = new_charges,
      status = new_status,
      last_charge_at = now()
  where id = sub_id;

  return query select new_charges, new_status;
end;
$$;
