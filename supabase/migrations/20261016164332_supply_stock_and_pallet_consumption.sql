-- Tenant-scoped supply inventory. Balances and immutable ledger change together.
create table public.supply_items (
 id uuid primary key, company_id uuid not null default empaque_private.current_company() references public.companies(id),
 code text not null check(length(trim(code)) between 1 and 60), name text not null check(length(trim(name)) between 1 and 180),
 unit text not null check(unit in ('un','m','kg','rollo')), minimum numeric not null default 0 check(minimum>=0 and minimum<1e12),
 active boolean not null default true, version integer not null default 1, created_at timestamptz not null default now(),
 unique(company_id,id), unique(company_id,code)
);
create table public.supply_depots (
 id uuid primary key, company_id uuid not null default empaque_private.current_company() references public.companies(id),
 name text not null check(length(trim(name)) between 1 and 120), allow_negative boolean not null default false,
 active boolean not null default true, version integer not null default 1, unique(company_id,id), unique(company_id,name)
);
create table public.supply_rules (
 id uuid primary key, company_id uuid not null default empaque_private.current_company() references public.companies(id),
 name text not null check(length(trim(name)) between 1 and 180), depot_id uuid not null,
 match jsonb not null, lines jsonb not null, active boolean not null default true, version integer not null default 1,
 created_at timestamptz not null default now(), foreign key(company_id,depot_id) references public.supply_depots(company_id,id), unique(company_id,id)
);
create unique index supply_rules_match_unique on public.supply_rules(company_id,match) where active;
create index supply_rules_depot on public.supply_rules(company_id,depot_id);
create table public.supply_documents (
 id uuid primary key, company_id uuid not null default empaque_private.current_company() references public.companies(id),
 kind text not null, number text not null, supplier text not null default '', occurred_on date not null default current_date,
 notes text not null default '', attachments jsonb not null default '[]', actor uuid default auth.uid(),
 reversed_by uuid, reverses uuid, created_at timestamptz not null default now(), unique(company_id,id)
);
create unique index supply_document_remito_unique on public.supply_documents(company_id,lower(trim(supplier)),lower(trim(number))) where kind='ingreso';
create index supply_document_page on public.supply_documents(company_id,created_at desc,id desc);
create table public.supply_balances (
 company_id uuid not null, item_id uuid not null, depot_id uuid not null, quantity numeric not null default 0,
 primary key(company_id,item_id,depot_id), foreign key(company_id,item_id) references public.supply_items(company_id,id),
 foreign key(company_id,depot_id) references public.supply_depots(company_id,id)
);
create index supply_balance_depot on public.supply_balances(company_id,depot_id);
create table public.supply_allocations (
 company_id uuid not null, pallet_id text not null, pallet_code text, recipe jsonb, amounts jsonb not null default '[]',
 status text not null check(status in ('sin_regla','aplicado','revertido')), version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(company_id,pallet_id)
);
create index supply_allocation_status on public.supply_allocations(company_id,status);
create table public.supply_movements (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, item_id uuid not null, depot_id uuid not null,
 quantity numeric not null check(quantity<>0 and abs(quantity)<1e12), kind text not null, document_id uuid,
 pallet_id text, pallet_code text, rule_name text, rule_version integer, actor uuid default auth.uid(), actor_name text, created_at timestamptz not null default now(),
 foreign key(company_id,item_id) references public.supply_items(company_id,id), foreign key(company_id,depot_id) references public.supply_depots(company_id,id),
 foreign key(company_id,document_id) references public.supply_documents(company_id,id)
);
create index supply_movement_page on public.supply_movements(company_id,created_at desc,id desc);
create index supply_movement_item on public.supply_movements(company_id,item_id,depot_id);
create index supply_movement_document on public.supply_movements(company_id,document_id);
create index supply_movement_pallet on public.supply_movements(company_id,pallet_id);
create table empaque_private.supply_receipts (
 company_id uuid not null, operation_id uuid not null, actor uuid not null default auth.uid(), request jsonb not null, result jsonb not null,
 created_at timestamptz not null default now(), primary key(company_id,operation_id)
);
alter table empaque_private.supply_receipts enable row level security;
grant select,insert on empaque_private.supply_receipts to authenticated;
create policy supply_receipts_own on empaque_private.supply_receipts to authenticated
 using(company_id=(select empaque_private.current_company()) and actor=(select auth.uid())) with check(company_id=(select empaque_private.current_company()) and actor=(select auth.uid()));

create function empaque_private.guard_supply_write() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if coalesce(current_setting('empaco.stock_command',true),'')<>'on' then raise exception 'Usá Stock Insumos para modificar el inventario'; end if;
 if tg_op='DELETE' then raise exception 'Los movimientos e insumos se conservan para auditoría'; end if;
 if tg_op='UPDATE' and new.company_id is distinct from old.company_id then raise exception 'Empresa inmutable'; end if;
 if new.company_id is distinct from empaque_private.current_company() then raise exception 'Empresa no autorizada' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function empaque_private.guard_supply_write() from public,anon,authenticated;
do $$declare t text; begin
 foreach t in array array['supply_items','supply_depots','supply_rules','supply_documents','supply_balances','supply_allocations','supply_movements'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select,insert,update on public.%I to authenticated',t);
 execute format('create policy supply_read on public.%I for select to authenticated using(company_id=(select empaque_private.current_company()) and coalesce((select empaque_private.my_role()),%L) not in (%L,%L))',t,'','user','');
 execute format('create policy supply_insert on public.%I for insert to authenticated with check(company_id=(select empaque_private.current_company()) and (select empaque_private.my_role()) in (%L,%L))',t,'admin','supervisor');
 execute format('create policy supply_update on public.%I for update to authenticated using(company_id=(select empaque_private.current_company()) and (select empaque_private.my_role()) in (%L,%L)) with check(company_id=(select empaque_private.current_company()) and (select empaque_private.my_role()) in (%L,%L))',t,'admin','supervisor','admin','supervisor');
 execute format('create trigger guard_supply_write before insert or update or delete on public.%I for each row execute function empaque_private.guard_supply_write()',t);
 end loop;
end $$;
-- Even managers cannot rewrite ledger history through the API.
revoke update on public.supply_movements from authenticated;

create function empaque_private.supply_move(p_company uuid,p_item uuid,p_depot uuid,p_quantity numeric,p_kind text,p_document uuid default null,p_pallet text default null,p_code text default null,p_recipe jsonb default null)
returns void language plpgsql security invoker set search_path='' as $$
declare item public.supply_items; depot public.supply_depots; balance numeric;
begin
 if p_quantity is null or p_quantity::text in ('NaN','Infinity','-Infinity') or abs(p_quantity)>=1e12 then raise exception 'Cantidad inválida'; end if;
 if p_quantity=0 then return; end if;
 select * into item from public.supply_items where company_id=p_company and id=p_item;
 select * into depot from public.supply_depots where company_id=p_company and id=p_depot;
 if item.id is null or depot.id is null then raise exception 'El insumo o depósito no pertenece a esta empresa'; end if;
 if item.unit='un' and p_quantity<>trunc(p_quantity) then raise exception 'El insumo % exige unidades enteras',item.name; end if;
 insert into public.supply_balances(company_id,item_id,depot_id,quantity) values(p_company,p_item,p_depot,0) on conflict do nothing;
 select quantity into balance from public.supply_balances where company_id=p_company and item_id=p_item and depot_id=p_depot for update;
 if balance+p_quantity<0 and not depot.allow_negative then raise exception 'Stock insuficiente de % en %. Registrá el ingreso o revisá la regla',item.name,depot.name; end if;
 update public.supply_balances set quantity=quantity+p_quantity where company_id=p_company and item_id=p_item and depot_id=p_depot;
 insert into public.supply_movements(company_id,item_id,depot_id,quantity,kind,document_id,pallet_id,pallet_code,rule_name,rule_version,actor_name)
 values(p_company,p_item,p_depot,p_quantity,p_kind,p_document,p_pallet,p_code,p_recipe->>'name',(p_recipe->>'version')::integer,(select full_name from public.profiles where id=auth.uid()));
end $$;
revoke all on function empaque_private.supply_move(uuid,uuid,uuid,numeric,text,uuid,text,text,jsonb) from public,anon;
grant execute on function empaque_private.supply_move(uuid,uuid,uuid,numeric,text,uuid,text,text,jsonb) to authenticated;

create function empaque_private.supply_reconcile(p_company uuid,p_pallet text,p_data jsonb,p_reselect boolean default false,p_remove boolean default false)
returns void language plpgsql security invoker set search_path='' as $$
declare allocation public.supply_allocations; recipe jsonb; desired jsonb:='[]'; line jsonb; old_line jsonb; candidates integer; qty numeric; code text; old_ctx text;
begin
 perform pg_advisory_xact_lock(hashtextextended('supply:'||p_company::text,0));
 select * into allocation from public.supply_allocations where company_id=p_company and pallet_id=p_pallet for update;
 code:=coalesce(p_data->>'romaneo_number',p_data->>'pallet_code',allocation.pallet_code,p_pallet);
 if p_remove and allocation.pallet_id is null then return; end if;
 recipe:=allocation.recipe;
 if not p_remove and (allocation.pallet_id is null or p_reselect) then
  select count(*) into candidates from public.supply_rules r where r.company_id=p_company and r.active and p_data @> r.match
   and (select count(*) from jsonb_object_keys(r.match))=(select max((select count(*) from jsonb_object_keys(rr.match))) from public.supply_rules rr where rr.company_id=p_company and rr.active and p_data @> rr.match);
  if candidates>1 then raise exception 'Hay reglas de insumos ambiguas para este pallet. Revisá Reglas de consumo'; end if;
  select to_jsonb(r) into recipe from public.supply_rules r where r.company_id=p_company and r.active and p_data @> r.match order by (select count(*) from jsonb_object_keys(r.match)) desc limit 1;
  if recipe is null and allocation.status='aplicado' then raise exception 'No hay regla de insumos para el nuevo armado. Configurala antes de cambiar el pallet'; end if;
 end if;
 if not p_remove and recipe is not null then
  if not exists(select 1 from public.supply_depots where company_id=p_company and id=(recipe->>'depot_id')::uuid and active) then raise exception 'El depósito de la regla está inactivo'; end if;
  for line in select value from jsonb_array_elements(recipe->'lines') loop
   if not exists(select 1 from public.supply_items where company_id=p_company and id=(line->>'item_id')::uuid and active) then raise exception 'Un insumo de la regla está inactivo'; end if;
   qty:=(line->>'quantity')::numeric * case when line->>'basis'='package' then coalesce((p_data->>'package_count')::numeric,0) else 1 end;
   desired:=desired||jsonb_build_array(jsonb_build_object('item_id',line->>'item_id','depot_id',recipe->>'depot_id','quantity',qty));
  end loop;
 end if;
 old_ctx:=current_setting('empaco.stock_command',true);perform set_config('empaco.stock_command','on',true);
 -- Apply only the difference, grouping material/depot pairs. Recipe versions are pinned.
 for line in select jsonb_build_object('item_id',item_id,'depot_id',depot_id,'quantity',sum(quantity)) from (
  select (x->>'item_id')::uuid item_id,(x->>'depot_id')::uuid depot_id,-(x->>'quantity')::numeric quantity from jsonb_array_elements(desired) x
  union all select (x->>'item_id')::uuid,(x->>'depot_id')::uuid,(x->>'quantity')::numeric from jsonb_array_elements(coalesce(allocation.amounts,'[]')) x
 ) q group by item_id,depot_id order by item_id,depot_id loop
  qty:=(line->>'quantity')::numeric;
  perform empaque_private.supply_move(p_company,(line->>'item_id')::uuid,(line->>'depot_id')::uuid,qty,case when qty>0 then 'reversion_automatica' else 'consumo_automatico' end,null,p_pallet,code,recipe);
 end loop;
 insert into public.supply_allocations(company_id,pallet_id,pallet_code,recipe,amounts,status) values(p_company,p_pallet,code,recipe,desired,case when p_remove then 'revertido' when recipe is null then 'sin_regla' else 'aplicado' end)
 on conflict(company_id,pallet_id) do update set recipe=excluded.recipe,amounts=excluded.amounts,status=excluded.status,pallet_code=excluded.pallet_code,version=public.supply_allocations.version+1,updated_at=now();
 perform set_config('empaco.stock_command',coalesce(old_ctx,''),true);
end $$;
revoke all on function empaque_private.supply_reconcile(uuid,text,jsonb,boolean,boolean) from public,anon,authenticated;

-- Narrow privileged trigger: production roles may consume supplies but cannot edit inventory.
create function empaque_private.pallet_supply_trigger() returns trigger language plpgsql security definer set search_path='' as $$
declare company uuid; previous public.supply_allocations; select_changed boolean;
begin
 if (case when tg_op='DELETE' then old.entity else new.entity end)<>'Pallet' then return null; end if;
 company:=case when tg_op='DELETE' then old.company_id else new.company_id end;
 if auth.uid() is null then return null; end if; -- service imports never invent physical consumption
 if company is distinct from empaque_private.current_company() or not empaque_private.allowed_write('Pallet') then raise exception 'Empresa o permiso de pallet inválido' using errcode='42501'; end if;
 if tg_op='INSERT' then perform empaque_private.supply_reconcile(company,new.id,new.data,false,new.data->>'status'='anulado');
 else
  select * into previous from public.supply_allocations where company_id=company and pallet_id=old.id;
  if previous.pallet_id is null then return null; end if; -- no retroactive consumption for existing pallets
  if tg_op='DELETE' then perform empaque_private.supply_reconcile(company,old.id,old.data,false,true);
  elsif new.data->>'package_count' is distinct from old.data->>'package_count'
    or (new.data->>'status'='anulado') is distinct from (old.data->>'status'='anulado')
    or (new.data->'product_type',new.data->'category',new.data->'package_type',new.data->'brand',new.data->'calibre',new.data->'pallet_type') is distinct from (old.data->'product_type',old.data->'category',old.data->'package_type',old.data->'brand',old.data->'calibre',old.data->'pallet_type') then
   select_changed:=(new.data->'product_type',new.data->'category',new.data->'package_type',new.data->'brand',new.data->'calibre',new.data->'pallet_type') is distinct from (old.data->'product_type',old.data->'category',old.data->'package_type',old.data->'brand',old.data->'calibre',old.data->'pallet_type');
   perform empaque_private.supply_reconcile(company,new.id,new.data,select_changed,new.data->>'status'='anulado');
  end if;
 end if;
 return null;
end $$;
revoke all on function empaque_private.pallet_supply_trigger() from public,anon,authenticated;
create trigger zz_pallet_supply after insert or update or delete on public.records for each row execute function empaque_private.pallet_supply_trigger();

create function empaque_private.supply_apply_missing(p_pallet text) returns void language plpgsql security definer set search_path='' as $$
declare p public.records; a public.supply_allocations; c uuid:=empaque_private.current_company();
begin
 if auth.uid() is null or coalesce(empaque_private.my_role(),'') not in ('admin','supervisor') then raise exception 'Solo responsables de stock' using errcode='42501'; end if;
 select * into p from public.records where company_id=c and entity='Pallet' and id=p_pallet for update;
 if not found then raise exception 'Pallet no encontrado'; end if;
 perform pg_advisory_xact_lock(hashtextextended('supply:'||c::text,0));
 select * into a from public.supply_allocations where company_id=c and pallet_id=p_pallet;
 if a.status is distinct from 'sin_regla' then raise exception 'El pallet no está pendiente de regla'; end if;
 if p.data->>'status' in ('anulado','enviado','despachado') then raise exception 'El pallet no admite esta corrección'; end if;
 perform empaque_private.supply_reconcile(c,p.id,p.data,true,false);
 if (select status from public.supply_allocations where company_id=c and pallet_id=p.id)='sin_regla' then raise exception 'Todavía no hay una regla aplicable'; end if;
end $$;
revoke all on function empaque_private.supply_apply_missing(text) from public,anon;
grant execute on function empaque_private.supply_apply_missing(text) to authenticated;

create function public.supply_command(p_operation_id uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c uuid:=empaque_private.current_company(); request jsonb; previous empaque_private.supply_receipts; result jsonb;
 v_id uuid; line jsonb; k text; qty numeric; old_ctx text; doc public.supply_documents; m public.supply_movements;
 existing_version integer; criteria jsonb; keys_count integer; attachment jsonb;
begin
 if auth.uid() is null or c is null or coalesce(empaque_private.my_role(),'') not in ('admin','supervisor') then raise exception 'Solo administradores y supervisores gestionan Stock Insumos' using errcode='42501'; end if;
 if p_operation_id is null or jsonb_typeof(p_payload) is distinct from 'object' or p_action is null or p_action not in ('item','depot','rule','movement','reverse_document','apply_rule') then raise exception 'Comando de stock inválido'; end if;
 request:=jsonb_build_object('action',p_action,'payload',p_payload);
 perform pg_advisory_xact_lock(hashtextextended('supply-operation:'||p_operation_id::text,0));
 select * into previous from empaque_private.supply_receipts where company_id=c and operation_id=p_operation_id;
 if found then if previous.request<>request then raise exception 'La operación ya pertenece a otros datos'; end if;return previous.result; end if;
 if p_action='apply_rule' then
  perform empaque_private.supply_apply_missing(p_payload->>'pallet_id');
 else
  perform pg_advisory_xact_lock(hashtextextended('supply:'||c::text,0));
  old_ctx:=current_setting('empaco.stock_command',true);perform set_config('empaco.stock_command','on',true);
  v_id:=coalesce(nullif(p_payload->>'id','')::uuid,p_operation_id);
  if p_action='item' then
   select version into existing_version from public.supply_items where company_id=c and supply_items.id=v_id;
   if found and existing_version is distinct from (p_payload->>'version')::integer then raise exception 'El insumo cambió. Volvé a abrir Editar'; end if;
   if exists(select 1 from public.supply_items where company_id=c and supply_items.id=v_id and unit<>p_payload->>'unit') and exists(select 1 from public.supply_movements where company_id=c and item_id=v_id) then raise exception 'No se puede cambiar la unidad de un insumo con movimientos'; end if;
   insert into public.supply_items(id,company_id,code,name,unit,minimum,active) values(v_id,c,upper(trim(p_payload->>'code')),trim(p_payload->>'name'),p_payload->>'unit',coalesce((p_payload->>'minimum')::numeric,0),coalesce((p_payload->>'active')::boolean,true))
   on conflict(id) do update set code=excluded.code,name=excluded.name,unit=excluded.unit,minimum=excluded.minimum,active=excluded.active,version=supply_items.version+1 where supply_items.company_id=c;
   if not found then raise exception 'Insumo de otra empresa'; end if;
  elsif p_action='depot' then
   select version into existing_version from public.supply_depots where company_id=c and supply_depots.id=v_id;
   if found and existing_version is distinct from (p_payload->>'version')::integer then raise exception 'El depósito cambió. Volvé a abrir Editar'; end if;
   insert into public.supply_depots(id,company_id,name,allow_negative,active) values(v_id,c,trim(p_payload->>'name'),coalesce((p_payload->>'allow_negative')::boolean,false),coalesce((p_payload->>'active')::boolean,true))
   on conflict(id) do update set name=excluded.name,allow_negative=excluded.allow_negative,active=excluded.active,version=supply_depots.version+1 where supply_depots.company_id=c;
   if not found then raise exception 'Depósito de otra empresa'; end if;
  elsif p_action='rule' then
   criteria:=p_payload->'match';
   if jsonb_typeof(criteria) is distinct from 'object' or nullif(trim(criteria->>'package_type'),'') is null or nullif(trim(criteria->>'product_type'),'') is null then raise exception 'La regla exige producto y envase'; end if;
   for k in select jsonb_object_keys(criteria) loop
    if k not in ('product_type','category','package_type','brand','calibre','pallet_type') or jsonb_typeof(criteria->k)<>'string' or nullif(trim(criteria->>k),'') is null then raise exception 'Condición de regla inválida'; end if;
   end loop;
   if not exists(select 1 from public.supply_depots where company_id=c and supply_depots.id=(p_payload->>'depot_id')::uuid and active) then raise exception 'Seleccioná un depósito activo'; end if;
   if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 100 then raise exception 'Agregá entre 1 y 100 insumos a la regla'; end if;
   if (select count(distinct value->>'item_id') from jsonb_array_elements(p_payload->'lines'))<>jsonb_array_length(p_payload->'lines') then raise exception 'No repitas un insumo en la regla'; end if;
   for line in select value from jsonb_array_elements(p_payload->'lines') loop
    qty:=(line->>'quantity')::numeric;
    if qty is null or qty::text in ('NaN','Infinity','-Infinity') or qty<=0 or qty>=1e9 or line->>'basis' not in ('pallet','package') or line->>'basis' is null then raise exception 'Cantidad o base de consumo inválida'; end if;
    if not exists(select 1 from public.supply_items where company_id=c and supply_items.id=(line->>'item_id')::uuid and active) then raise exception 'La regla contiene un insumo inexistente o inactivo'; end if;
   end loop;
   select version into existing_version from public.supply_rules where company_id=c and supply_rules.id=v_id;
   if found and existing_version is distinct from (p_payload->>'version')::integer then raise exception 'La regla cambió. Volvé a abrir Editar'; end if;
   insert into public.supply_rules(id,company_id,name,depot_id,match,lines,active) values(v_id,c,trim(p_payload->>'name'),(p_payload->>'depot_id')::uuid,criteria,p_payload->'lines',coalesce((p_payload->>'active')::boolean,true))
   on conflict(id) do update set name=excluded.name,depot_id=excluded.depot_id,match=excluded.match,lines=excluded.lines,active=excluded.active,version=supply_rules.version+1 where supply_rules.company_id=c;
   if not found then raise exception 'Regla de otra empresa'; end if;
  elsif p_action='movement' then
   k:=p_payload->>'kind';
   if k is null or k not in ('ingreso','inicial','devolucion','rotura','ajuste','traslado') then raise exception 'Los consumos se generan automáticamente desde los pallets'; end if;
   if k='ingreso' and (nullif(trim(p_payload->>'number'),'') is null or nullif(trim(p_payload->>'supplier'),'') is null) then raise exception 'Proveedor y remito son obligatorios'; end if;
   if k<>'ingreso' and nullif(trim(p_payload->>'notes'),'') is null then raise exception 'Ingresá el motivo del movimiento'; end if;
   if (p_payload->>'occurred_on')::date is null or (p_payload->>'occurred_on')::date>(now() at time zone 'America/Argentina/Buenos_Aires')::date then raise exception 'Revisá la fecha del comprobante'; end if;
   if not exists(select 1 from public.supply_depots where company_id=c and supply_depots.id=(p_payload->>'depot_id')::uuid and active) then raise exception 'Depósito inválido'; end if;
   if k='traslado' and ((p_payload->>'depot_id')=(p_payload->>'destination_id') or not exists(select 1 from public.supply_depots where company_id=c and supply_depots.id=(p_payload->>'destination_id')::uuid and active)) then raise exception 'Seleccioná otro depósito de destino'; end if;
   if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 100 then raise exception 'Agregá entre 1 y 100 líneas'; end if;
   if jsonb_typeof(coalesce(p_payload->'attachments','[]')) is distinct from 'array' or jsonb_array_length(coalesce(p_payload->'attachments','[]'))>3 then raise exception 'Máximo tres adjuntos'; end if;
   for attachment in select value from jsonb_array_elements(coalesce(p_payload->'attachments','[]')) loop
    if left(attachment->>'path',length(c::text)+1) is distinct from c::text||'/' or (attachment->>'path') like '%..%' or nullif(attachment->>'name','') is null then raise exception 'Adjunto de otra empresa o inválido'; end if;
   end loop;
   insert into public.supply_documents(id,company_id,kind,number,supplier,occurred_on,notes,attachments) values(p_operation_id,c,k,coalesce(nullif(trim(p_payload->>'number'),''),upper(k)||'-'||left(p_operation_id::text,8)),coalesce(trim(p_payload->>'supplier'),''),(p_payload->>'occurred_on')::date,coalesce(p_payload->>'notes',''),coalesce(p_payload->'attachments','[]'));
   for line in select value from jsonb_array_elements(p_payload->'lines') loop
    qty:=(line->>'quantity')::numeric;
    if qty is null or qty::text in ('NaN','Infinity','-Infinity') or qty=0 or abs(qty)>=1e9 or (k<>'ajuste' and qty<0) then raise exception 'Cantidad inválida'; end if;
    if not exists(select 1 from public.supply_items where company_id=c and supply_items.id=(line->>'item_id')::uuid and active) then raise exception 'Seleccioná un insumo activo'; end if;
    perform empaque_private.supply_move(c,(line->>'item_id')::uuid,(p_payload->>'depot_id')::uuid,case when k in ('rotura','traslado') then -qty else qty end,k,p_operation_id);
    if k='traslado' then perform empaque_private.supply_move(c,(line->>'item_id')::uuid,(p_payload->>'destination_id')::uuid,qty,k,p_operation_id); end if;
   end loop;
  elsif p_action='reverse_document' then
   select * into doc from public.supply_documents where company_id=c and supply_documents.id=(p_payload->>'document_id')::uuid for update;
   if not found or doc.reversed_by is not null or doc.reverses is not null then raise exception 'El comprobante no admite reversión'; end if;
   if nullif(trim(p_payload->>'notes'),'') is null then raise exception 'Indicá el motivo de la reversión'; end if;
   insert into public.supply_documents(id,company_id,kind,number,notes,reverses) values(p_operation_id,c,'reversion','REV-'||doc.number,p_payload->>'notes',doc.id);
   for m in select * from public.supply_movements where company_id=c and document_id=doc.id order by item_id,depot_id loop
    perform empaque_private.supply_move(c,m.item_id,m.depot_id,-m.quantity,'reversion',p_operation_id);
   end loop;
   update public.supply_documents set reversed_by=p_operation_id where company_id=c and supply_documents.id=doc.id;
  end if;
  perform set_config('empaco.stock_command',coalesce(old_ctx,''),true);
 end if;
 result:=jsonb_build_object('ok',true,'operation_id',p_operation_id);
 insert into empaque_private.supply_receipts(company_id,operation_id,request,result) values(c,p_operation_id,request,result);
 return result;
end $$;
revoke all on function public.supply_command(uuid,text,jsonb) from public,anon;
grant execute on function public.supply_command(uuid,text,jsonb) to authenticated;

create function public.supply_snapshot(p_before timestamptz default null,p_before_id uuid default null,p_kind text default null,p_search text default null,p_depot uuid default null,p_from date default null,p_to date default null,p_limit integer default 100)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c uuid:=empaque_private.current_company(); moves jsonb; docs jsonb; actors jsonb;
begin
 if auth.uid() is null or c is null or coalesce(empaque_private.my_role(),'') in ('','user') then raise exception 'Acceso de stock no autorizado' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by created_at desc,id desc),'[]') into moves from (
  select m.* from public.supply_movements m left join public.supply_items i on i.company_id=c and i.id=m.item_id left join public.supply_documents d on d.company_id=c and d.id=m.document_id
  where m.company_id=c and (p_before is null or (m.created_at,m.id)<(p_before,p_before_id))
   and (nullif(p_kind,'') is null or m.kind=p_kind) and (p_depot is null or m.depot_id=p_depot)
   and (p_from is null or coalesce(d.occurred_on,(m.created_at at time zone 'America/Argentina/Buenos_Aires')::date)>=p_from)
   and (p_to is null or coalesce(d.occurred_on,(m.created_at at time zone 'America/Argentina/Buenos_Aires')::date)<=p_to)
   and (nullif(trim(p_search),'') is null or concat_ws(' ',i.name,i.code,d.number,d.supplier,m.pallet_code) ilike '%'||p_search||'%')
  order by m.created_at desc,m.id desc limit least(greatest(coalesce(p_limit,100),1),200)
 ) q;
 select coalesce(jsonb_agg(to_jsonb(d)),'[]') into docs from public.supply_documents d where d.company_id=c and d.id in (select (x->>'document_id')::uuid from jsonb_array_elements(moves) x where x->>'document_id' is not null);
 -- Show operator names only for records already visible in this company's ledger.
 select coalesce(jsonb_object_agg(p.id,p.full_name),'{}') into actors from public.profiles p where p.id in (select (x->>'actor')::uuid from jsonb_array_elements(moves) x where x->>'actor' is not null);
 return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(i) order by name) from public.supply_items i where company_id=c),'[]'),
  'depots',coalesce((select jsonb_agg(to_jsonb(d) order by name) from public.supply_depots d where company_id=c),'[]'),
  'rules',coalesce((select jsonb_agg(to_jsonb(r) order by name) from public.supply_rules r where company_id=c),'[]'),
  'balances',coalesce((select jsonb_agg(to_jsonb(b)) from public.supply_balances b where company_id=c),'[]'),
  'pending',coalesce((select jsonb_agg(to_jsonb(a) order by created_at desc) from (select * from public.supply_allocations where company_id=c and status='sin_regla' order by created_at desc limit 100) a),'[]'),
  'pending_count',(select count(*) from public.supply_allocations where company_id=c and status='sin_regla'),
  'consumed_count',(select count(*) from public.supply_allocations where company_id=c and status='aplicado'),
  'monthly_receipts',(select count(*) from public.supply_documents where company_id=c and kind='ingreso' and reversed_by is null and occurred_on>=date_trunc('month',now() at time zone 'America/Argentina/Buenos_Aires')::date and occurred_on<= (now() at time zone 'America/Argentina/Buenos_Aires')::date),
  'movements',moves,'documents',docs,'actors',actors,'as_of',now(),'company_id',c);
end $$;
revoke all on function public.supply_snapshot(timestamptz,uuid,text,text,uuid,date,date,integer) from public,anon;
grant execute on function public.supply_snapshot(timestamptz,uuid,text,text,uuid,date,date,integer) to authenticated;

-- Remitos are private: company-specific paths and the same stock-manager roles.
do $$begin
 if to_regclass('storage.buckets') is not null then
  insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('supply-remitos','supply-remitos',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf']) on conflict(id) do nothing;
  execute $p$create policy supply_remitos_read on storage.objects for select to authenticated using(bucket_id='supply-remitos' and split_part(name,'/',1)=(select empaque_private.current_company())::text and coalesce((select empaque_private.my_role()),'') not in ('','user'))$p$;
  execute $p$create policy supply_remitos_insert on storage.objects for insert to authenticated with check(bucket_id='supply-remitos' and split_part(name,'/',1)=(select empaque_private.current_company())::text and (select empaque_private.my_role()) in ('admin','supervisor'))$p$;
 end if;
end $$;

create function public.supply_document_detail(p_document uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c uuid:=empaque_private.current_company(); doc public.supply_documents;
begin
 if auth.uid() is null or c is null or coalesce(empaque_private.my_role(),'') in ('','user') then raise exception 'Acceso no autorizado' using errcode='42501'; end if;
 select * into doc from public.supply_documents where company_id=c and id=p_document;
 if not found then raise exception 'Comprobante no encontrado'; end if;
 return jsonb_build_object('document',to_jsonb(doc),'movements',coalesce((select jsonb_agg(to_jsonb(m) order by created_at,id) from public.supply_movements m where company_id=c and document_id=p_document),'[]'));
end $$;
revoke all on function public.supply_document_detail(uuid) from public,anon;
grant execute on function public.supply_document_detail(uuid) to authenticated;
