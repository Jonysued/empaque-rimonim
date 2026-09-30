begin;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where role='admin' order by id limit 1),true);
set local role authenticated;
do $$
declare
  shipment text := gen_random_uuid()::text;
  p1 text := gen_random_uuid()::text;
  p2 text := gen_random_uuid()::text;
  empty_load text := gen_random_uuid()::text;
  state jsonb; original_stamp text; n integer; failed boolean;
begin
  insert into public.records(entity,id,data) values
    ('Pallet',p1,jsonb_build_object('status','despachado','shipment_id',shipment,'net_weight',500)),
    ('Pallet',p2,jsonb_build_object('status','despachado','shipment_id',shipment,'net_weight',400)),
    ('Shipment',shipment,jsonb_build_object('status','cargado','loaded_pallet_ids',jsonb_build_array(p1,p2),'load_number','TEST','destination','TEST')),
    ('Shipment',empty_load,jsonb_build_object('status','borrador','loaded_pallet_ids','[]'::jsonb));
  failed:=false;
  begin perform public.patch_record('Shipment',empty_load,'{"status":"enviado"}'); exception when others then failed:=true; end;
  if not failed then raise exception 'Empty load dispatched'; end if;
  perform public.patch_record('Shipment',shipment,'{"status":"enviado","dispatched_at":"2000-01-01T00:00:00Z"}');
  select data into state from public.records where entity='Shipment' and id=shipment;
  original_stamp:=state->>'dispatched_at';
  if original_stamp is null or original_stamp::timestamptz<>now() then raise exception 'Departure not server timestamped'; end if;
  select count(*) into n from public.records where entity='MovementEvent' and data->>'shipment_id'=shipment and data->>'action'='salida_despacho';
  if n<>2 then raise exception 'Departure missing per pallet'; end if;
  perform public.patch_record('Shipment',shipment,'{"status":"enviado","dispatched_at":"2000-01-01T00:00:00Z","remito":"EDIT"}');
  select data into state from public.records where entity='Shipment' and id=shipment;
  if state->>'dispatched_at'<>original_stamp then raise exception 'Retry or metadata edit changed timestamp'; end if;
  select count(*) into n from public.records where entity='MovementEvent' and data->>'shipment_id'=shipment and data->>'action'='salida_despacho';
  if n<>2 then raise exception 'Repeated departure created duplicate events'; end if;
  perform public.reopen_shipment_for_correction(gen_random_uuid(),shipment);
  select data into state from public.records where entity='Shipment' and id=shipment;
  if state ? 'dispatched_at' or state ? 'dispatch_event_id' then raise exception 'Reopened shipment kept active departure'; end if;
  perform public.unload_pallet_from_shipment(gen_random_uuid(),shipment,p2);
  perform public.patch_record('Shipment',shipment,'{"status":"enviado"}');
  select count(*) into n from public.records where entity='MovementEvent' and data->>'shipment_id'=shipment and data->>'action'='salida_despacho';
  if n<>3 then raise exception 'Reconfirmed departure should only include remaining pallet'; end if;
  perform public.reopen_shipment_for_correction(gen_random_uuid(),shipment);
  perform set_config('request.jwt.claim.sub','',true);
  failed:=false;
  begin perform public.patch_record('Shipment',shipment,'{"status":"enviado"}'); exception when others then failed:=true; end;
  if not failed then raise exception 'Unauthenticated departure accepted'; end if;
end;
$$;
rollback;
select 'PASS: authenticated departure, server timestamp, atomic per-pallet history, retries, reopen and corrections (rolled back)' as result;
