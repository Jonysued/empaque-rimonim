-- All synthetic operational records below are rolled back.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where role='admin' order by id limit 1),true);
set local role authenticated;
do $$
declare
  lot_a text := gen_random_uuid()::text;
  lot_b text := gen_random_uuid()::text;
  create_id uuid := gen_random_uuid();
  close_id uuid := gen_random_uuid();
  weigh_id uuid := gen_random_uuid();
  receive_id uuid := gen_random_uuid();
  dump_id uuid := gen_random_uuid();
  bin_a text := 'BIN-TEST-' || gen_random_uuid()::text;
  bin_b text := 'BIN-TEST-' || gen_random_uuid()::text;
  bin_c text := 'BIN-TEST-' || gen_random_uuid()::text;
  record_a jsonb;
  result jsonb;
  state jsonb;
  n integer;
  failed boolean;
begin
  record_a := jsonb_build_object('lot_code','LOT-TEST-'||lot_a,'producer','LAS 500','variety','Wonderful',
    'harvest_date','2026-09-30','expected_bins_count',3,'crew','MIXTO',
    'crew_breakdown',jsonb_build_array(jsonb_build_object('crew','A','bins_count',2),jsonb_build_object('crew','B','bins_count',1)));
  result := public.field_lot_operation(create_id,lot_a,'create',record_a);
  if result->'lot' ? 'net_weight' or result->'lot'->>'status' <> 'en_campo' then raise exception 'Creation must not weigh the lot'; end if;
  result := public.field_lot_operation(create_id,lot_a,'create',record_a);
  if result->>'already_applied' <> 'true' then raise exception 'Create replay was not idempotent'; end if;
  perform public.field_lot_operation(gen_random_uuid(),lot_b,'create',jsonb_build_object('lot_code','LOT-TEST-'||lot_b,
    'producer','GLONET','variety','Wonderful','harvest_date','2026-09-30','expected_bins_count',1));
  failed := false;
  begin perform public.field_lot_operation(gen_random_uuid(),lot_a,'weigh','{}',null,1000,100);
  exception when others then failed := true; end;
  if not failed then raise exception 'Allowed weighing an open lot'; end if;
  perform public.field_lot_operation(gen_random_uuid(),lot_a,'add_bin','{}',bin_a);
  failed := false;
  begin perform public.field_lot_operation(gen_random_uuid(),lot_a,'close');
  exception when others then failed := true; end;
  if not failed then raise exception 'Allowed closing an incomplete lot'; end if;
  failed := false;
  begin perform public.field_lot_operation(gen_random_uuid(),lot_b,'add_bin','{}',lower(bin_a));
  exception when others then failed := true; end;
  if not failed then raise exception 'BIN associated with two active lots'; end if;
  failed := false;
  begin perform public.field_lot_operation(gen_random_uuid(),lot_a,'add_bin','{}',bin_a);
  exception when others then failed := true; end;
  if not failed then raise exception 'BIN scanned twice'; end if;
  perform public.field_lot_operation(gen_random_uuid(),lot_a,'add_bin','{}',bin_b);
  perform public.field_lot_operation(gen_random_uuid(),lot_a,'remove_bin','{}',bin_b);
  perform public.field_lot_operation(gen_random_uuid(),lot_a,'add_bin','{}',bin_b);
  perform public.field_lot_operation(gen_random_uuid(),lot_a,'add_bin','{}',bin_c);
  perform public.field_lot_operation(close_id,lot_a,'close');
  failed := false;
  begin perform public.field_lot_operation(gen_random_uuid(),lot_a,'remove_bin','{}',bin_b);
  exception when others then failed := true; end;
  if not failed then raise exception 'BIN removed after lot closure'; end if;
  failed := false;
  begin perform public.field_lot_operation(gen_random_uuid(),lot_a,'weigh','{}',null,1000,1100);
  exception when others then failed := true; end;
  if not failed then raise exception 'Accepted an invalid tare'; end if;
  perform public.field_lot_operation(weigh_id,lot_a,'weigh','{}',null,1300.1,300);
  select data into state from public.records where entity='ReceiptLot' and id=lot_a;
  if (state->>'net_weight')::numeric <> 1000.1 then raise exception 'Net weight calculation failed'; end if;
  select count(*) into n from public.records where entity='Bin' and data->>'receipt_lot_id'=lot_a
    and abs((data->>'net_weight')::numeric - 1000.1/3) < 0.0000001;
  if n <> 3 then raise exception 'Weight was not prorated to all BINs'; end if;
  failed := false;
  begin perform public.dump_lot_by_bins(gen_random_uuid(),lot_a,1,'VOL-TEST');
  exception when others then failed := true; end;
  if not failed then raise exception 'Allowed dumping before yard reception'; end if;
  failed := false;
  begin perform public.patch_record('ReceiptLot',lot_a,jsonb_build_object('status','recibido','yard_received_at',now()));
  exception when others then failed := true; end;
  if not failed then raise exception 'Direct patch bypassed the reception gate'; end if;
  perform public.field_lot_operation(receive_id,lot_a,'receive');
  result := public.field_lot_operation(receive_id,lot_a,'receive');
  if result->>'already_applied' <> 'true' then raise exception 'Reception replay was not idempotent'; end if;
  failed := false;
  begin perform public.field_lot_operation(gen_random_uuid(),lot_a,'receive');
  exception when others then failed := true; end;
  if not failed then raise exception 'Allowed a second reception'; end if;
  perform public.dump_lot_by_bins(dump_id,lot_a,1,'VOL-TEST-PARTIAL');
  perform public.dump_lot_by_bins(dump_id,lot_a,1,'VOL-TEST-PARTIAL');
  select data into state from public.records where entity='ReceiptLot' and id=lot_a;
  if (state->>'bins_dumped')::integer <> 1 then raise exception 'Dump replay counted BINs twice'; end if;
  perform public.dump_lot_by_bins(gen_random_uuid(),lot_a,2,'VOL-TEST-FINAL');
  select data into state from public.records where entity='ReceiptLot' and id=lot_a;
  if (state->>'remaining_weight')::numeric <> 0 or (state->>'dumped_weight')::numeric <> 1000.1 then
    raise exception 'Final dump lost or duplicated weight'; end if;
  perform public.field_lot_operation(gen_random_uuid(),lot_b,'add_bin','{}',bin_a);
  select count(*) into n from public.records where entity='Bin' and data->>'bin_code'=upper(bin_a);
  if n <> 2 then raise exception 'Reusing an emptied BIN did not preserve its history'; end if;
  -- Verify original stage replays after later transitions remain harmless.
  result := public.field_lot_operation(close_id,lot_a,'close');
  if result->>'already_applied' <> 'true' or result->'lot'->>'status' <> 'volcado' then raise exception 'Close replay rolled back a later state'; end if;
end;
$$;
rollback;
select 'PASS: campo, BINs únicos, cierre, pesado, prorrateo, recepción, vuelco parcial, reintentos e historial; sin datos de prueba persistidos' as verification;
