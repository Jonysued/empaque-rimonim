-- Allocate romaneos independently of cached client lists. The counter is private
-- and is the only privileged write; RLS still governs every operational record.
create table empaque_private.romaneo_counters (
 year integer primary key,
 last_number bigint not null check(last_number>=0)
);
alter table empaque_private.romaneo_counters enable row level security;
revoke all on empaque_private.romaneo_counters from public,anon,authenticated;
insert into empaque_private.romaneo_counters(year,last_number)
select substring(data->>'romaneo_number' from 5 for 4)::integer,
 max(substring(data->>'romaneo_number' from 10)::bigint)
from public.records where entity='Pallet' and data->>'romaneo_number' ~ '^ROM-[0-9]{4}-[0-9]+$'
group by 1;

create function empaque_private.next_romaneo() returns text
language plpgsql security definer set search_path='' as $$
declare v_year integer; v_number bigint;
begin
 if (select auth.uid()) is null or not empaque_private.allowed_write('Pallet') then
  raise exception 'No tenés permiso para crear pallets' using errcode='42501';
 end if;
 v_year:=extract(year from timezone('America/Argentina/Buenos_Aires',clock_timestamp()))::integer;
 insert into empaque_private.romaneo_counters(year,last_number) values(v_year,1)
 on conflict(year) do update set last_number=empaque_private.romaneo_counters.last_number+1
 returning last_number into v_number;
 return 'ROM-'||v_year::text||'-'||case when v_number<100000 then lpad(v_number::text,5,'0') else v_number::text end;
end $$;
revoke all on function empaque_private.next_romaneo() from public,anon;
grant execute on function empaque_private.next_romaneo() to authenticated;

create unique index records_romaneo_unique on public.records((data->>'romaneo_number'))
 where entity='Pallet' and nullif(data->>'romaneo_number','') is not null;
create unique index records_pallet_code_unique on public.records((data->>'pallet_code'))
 where entity='Pallet' and nullif(data->>'pallet_code','') is not null;

create function public.guard_pallet_integrity() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v_value numeric; v_key text;
begin
 if (case when tg_op='DELETE' then old.entity else new.entity end)<>'Pallet' then
  if tg_op='DELETE' then return old; end if;
  return new;
 end if;
 if tg_op='DELETE' then
  if old.data->>'shipment_id' is not null
   or exists(select 1 from public.records where entity='Shipment' and data->'loaded_pallet_ids' ? old.id)
   or exists(select 1 from public.records where entity='MovementEvent' and data->>'unit_type'='pallet' and data->>'unit_id'=old.id) then
   raise exception 'No se puede eliminar un pallet con movimientos o asignado a un despacho';
  end if;
  return old;
 end if;
 if tg_op='INSERT' then
  new.data:=new.data||jsonb_build_object('romaneo_number',empaque_private.next_romaneo(),
   'pallet_code',coalesce(nullif(trim(new.data->>'pallet_code'),''),'PAL-'||new.id));
 elsif new.id<>old.id or new.data->>'romaneo_number' is distinct from old.data->>'romaneo_number'
  or new.data->>'pallet_code' is distinct from old.data->>'pallet_code' then
  raise exception 'El código y el número de romaneo identifican al pallet y no se pueden cambiar';
 end if;
 foreach v_key in array array['net_weight','gross_weight','tare_weight','package_count'] loop
  if (tg_op='INSERT' or new.data->v_key is distinct from old.data->v_key) and new.data->>v_key is not null then
   v_value:=nullif(new.data->>v_key,'')::numeric;
   if v_value is null or v_value::text in ('NaN','Infinity','-Infinity') or v_value<0
    or (v_key='net_weight' and v_value<=0) or (v_key='package_count' and trunc(v_value)<>v_value) then
    raise exception 'Ingresá pesos válidos y una cantidad entera de bultos sin valores negativos';
   end if;
  end if;
 end loop;
 if tg_op='UPDATE' and old.data->>'shipment_id' is not null
  and new.data->>'product_type' is distinct from old.data->>'product_type' then
  raise exception 'Retirá el pallet del despacho antes de cambiar su producto';
 end if;
 return new;
end $$;
revoke all on function public.guard_pallet_integrity() from public,anon,authenticated;
create trigger guard_pallet_integrity before insert or update or delete on public.records
 for each row execute function public.guard_pallet_integrity();

-- Production can edit a loaded pallet without broad Shipment write access.
-- This trigger updates only the matching load totals after locking its row.
create function empaque_private.refresh_loaded_pallet_totals() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_shipment public.records; v_weight numeric; v_packages numeric;
begin
 if old.data->>'shipment_id' is null or new.data->>'shipment_id' is distinct from old.data->>'shipment_id'
  or new.data=old.data then return new; end if;
 if (select auth.uid()) is null or not empaque_private.allowed_write('Pallet') then
  raise exception 'No tenés permiso para editar pallets' using errcode='42501';
 end if;
 select * into v_shipment from public.records where entity='Shipment' and id=old.data->>'shipment_id' for update;
 if not found or not coalesce(v_shipment.data->'loaded_pallet_ids','[]'::jsonb) ? old.id then
  raise exception 'El pallet no coincide con la carga; revisá el despacho';
 end if;
 if coalesce(v_shipment.data->>'status','') not in ('borrador','reservado','cargado') then
  raise exception 'Reabrí el despacho antes de corregir un pallet enviado';
 end if;
 if new.data->>'net_weight' is distinct from old.data->>'net_weight'
  or new.data->>'package_count' is distinct from old.data->>'package_count' then
  v_weight:=coalesce((v_shipment.data->>'total_weight')::numeric,0)
   +coalesce((new.data->>'net_weight')::numeric,0)-coalesce((old.data->>'net_weight')::numeric,0);
  v_packages:=coalesce((v_shipment.data->>'total_packages')::numeric,0)
   +coalesce((new.data->>'package_count')::numeric,0)-coalesce((old.data->>'package_count')::numeric,0);
  update public.records set data=data||jsonb_build_object('total_weight',v_weight,'total_packages',v_packages),updated_date=now()
   where entity='Shipment' and id=v_shipment.id;
 end if;
 return new;
end $$;
revoke all on function empaque_private.refresh_loaded_pallet_totals() from public,anon,authenticated;
create trigger refresh_loaded_pallet_totals after update on public.records
 for each row when (new.entity='Pallet') execute function empaque_private.refresh_loaded_pallet_totals();

create function public.guard_shipment_integrity() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v_loaded jsonb; v_capacity integer;
begin
 if (case when tg_op='DELETE' then old.entity else new.entity end)<>'Shipment' then
  if tg_op='DELETE' then return old; end if;
  return new;
 end if;
 if tg_op='DELETE' then
  if jsonb_array_length(coalesce(old.data->'loaded_pallet_ids','[]'))>0 then
   raise exception 'Retirá los pallets antes de eliminar la carga';
  end if;
  return old;
 end if;
 v_loaded:=coalesce(new.data->'loaded_pallet_ids','[]');
 if jsonb_typeof(v_loaded)<>'array' then raise exception 'La lista de pallets es inválida'; end if;
 v_capacity:=coalesce(nullif(new.data->>'target_capacity','')::integer,21);
 if v_capacity<1 or v_capacity<jsonb_array_length(v_loaded) then
  raise exception 'La capacidad no puede ser menor a la cantidad de pallets cargados';
 end if;
 if tg_op='UPDATE' and jsonb_array_length(coalesce(old.data->'loaded_pallet_ids','[]'))>0
  and new.data->>'product_type' is distinct from old.data->>'product_type' then
  raise exception 'No se puede cambiar el producto de una carga con pallets';
 end if;
 return new;
end $$;
revoke all on function public.guard_shipment_integrity() from public,anon,authenticated;
create trigger guard_shipment_integrity before insert or update or delete on public.records
 for each row execute function public.guard_shipment_integrity();
