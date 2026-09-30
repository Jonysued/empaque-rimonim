-- New lots follow field -> weighing -> packing-yard reception.
-- Existing lots deliberately retain their original balances and workflow.
create or replace function public.guard_field_lot_workflow()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_managed boolean := false; v_context text; v_allowed text[] := '{}';
begin
  v_context := coalesce(current_setting('rimonim.field_lot_id',true),'');
  if tg_op <> 'INSERT' then
    v_managed := (old.entity='ReceiptLot' and old.data->>'workflow_version' in ('2','3'))
      or (old.entity='Bin' and (old.data->>'field_workflow'='true' or old.data->>'harvest_workflow'='3'));
    if old.entity='ReceiptLot' then v_allowed:=v_allowed || old.id;
    else v_allowed:=v_allowed || coalesce(old.data->>'receipt_lot_id','harvest:'||old.id); end if;
  end if;
  if tg_op <> 'DELETE' then
    v_managed := coalesce(v_managed,false) or (new.entity='ReceiptLot' and new.data->>'workflow_version' in ('2','3'))
      or (new.entity='Bin' and (new.data->>'field_workflow'='true' or new.data->>'harvest_workflow'='3'));
    if new.entity='ReceiptLot' then v_allowed:=v_allowed || new.id;
    elsif new.entity='Bin' then
      v_allowed:=v_allowed || coalesce(new.data->>'receipt_lot_id','harvest:'||new.id);
      v_managed:=coalesce(v_managed,false) or exists(select 1 from public.records where entity='ReceiptLot'
        and id=new.data->>'receipt_lot_id' and data->>'workflow_version' in ('2','3'));
    end if;
    if tg_op='UPDATE' and old.entity='ReceiptLot' and new.entity=old.entity and new.id=old.id
      and (new.data-array['held','quality_notes'])=(old.data-array['held','quality_notes']) then return new; end if;
  end if;
  if v_managed and not (v_context=any(v_allowed)) then
    raise exception 'Usá Cosecha o la estación correspondiente para modificar este registro';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.guard_field_lot_workflow() from public,anon,authenticated;

