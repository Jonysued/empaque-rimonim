-- Authorized database regression, synthetic records are rolled back.
begin;
select set_config('empaco.qa_actor_a',(select id::text from public.profiles where role='admin' order by email limit 1),true);
select set_config('empaco.qa_actor_b',(select id::text from public.profiles where role='admin' and id::text<>current_setting('empaco.qa_actor_a') order by email limit 1),true);
do $$declare v_company uuid; begin
 insert into public.companies(name,slug) values('QA transaccional','qa-transaccional-20261005') returning id into v_company;
 perform set_config('empaco.qa_company',v_company::text,true);
 insert into public.company_memberships(company_id,user_id,role) values(v_company,current_setting('empaco.qa_actor_b')::uuid,'admin');
end $$;
select set_config('request.jwt.claim.sub',current_setting('empaco.qa_actor_b'),true),set_config('request.headers',jsonb_build_object('x-empaco-company',current_setting('empaco.qa_company'))::text,true);
set local role authenticated;
insert into public.records(entity,id,data) values('Catalog','qa-tenant-catalog-20261005','{"type":"productor","label":"QA","active":true}');
do $$begin
 if (select count(*) from public.records)<>1 then raise exception 'La empresa QA ve registros externos'; end if;
 if (select count(*) from public.company_users())<>1 then raise exception 'La empresa QA ve otros usuarios'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('empaco.qa_actor_a'),true);
set local role authenticated;
do $$begin
 if exists(select 1 from public.records) then raise exception 'Un encabezado falsificado expone datos'; end if;
 begin
  perform public.patch_record('Catalog','qa-tenant-catalog-20261005','{"label":"modificado"}','{}');
  raise exception 'Edición externa permitida';
 exception when others then if sqlerrm='Edición externa permitida' then raise; end if; end;
end $$;
reset role;
select set_config('request.headers','{}',true);
set local role authenticated;
do $$begin
 if not exists(select 1 from public.records where entity='Catalog') then raise exception 'Rimonim perdió sus catálogos'; end if;
 if exists(select 1 from public.records where id='qa-tenant-catalog-20261005') then raise exception 'Rimonim ve registros externos'; end if;
end $$;
reset role;
rollback;
select 'PASS: aislamiento productivo, usuarios separados y compatibilidad Rimonim; pruebas revertidas' result;
