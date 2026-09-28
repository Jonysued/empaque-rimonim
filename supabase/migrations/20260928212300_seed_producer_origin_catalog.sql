with seeds as (
  select 'GLONET'::text producer, 'CUADRO ' || n::text label
  from unnest(array[16,15,14,13,12,11,9,8,7,6,5,4,3,2,1]) n
  union all
  select 'LAS 500', 'OP' || n::text || sector
  from generate_series(1,3) n cross join (values ('NE'),('SE'),('NO'),('SO')) sectors(sector)
), missing as (
  select s.*, gen_random_uuid()::text as id
  from seeds s
  where exists (
    select 1 from public.records r
    where r.entity='Catalog' and r.data->>'type'='productor'
      and upper(r.data->>'label')=s.producer and coalesce((r.data->>'active')::boolean,true)
  )
  and not exists (
    select 1 from public.records r
    where r.entity='Catalog' and r.data->>'type'='cuadro'
      and r.data->>'label'=s.label and upper(r.data->>'producer')=s.producer
  )
)
insert into public.records(entity,id,data)
select 'Catalog',id,jsonb_build_object('id',id,'type','cuadro','label',label,'value',label,'producer',producer,'active',true)
from missing;
