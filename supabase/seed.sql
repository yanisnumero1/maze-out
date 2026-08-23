-- Seed de démonstration, sûr à relancer : il n'écrase pas une configuration déjà personnalisée.
insert into public.zones(name,display_order)
select v.name,v.display_order from (values ('Carré 1',1),('Carré 2',2),('Carré 3',3),('Carré 4',4)) as v(name,display_order)
where not exists (select 1 from public.zones z where z.name=v.name);

insert into public.head_waiters(first_name,last_name,color)
select v.first_name,v.last_name,v.color from (values ('Antoine','CDR','#e879f9'),('Camille','CDR','#60a5fa'),('Jules','CDR','#34d399'),('Lina','CDR','#fbbf24'),('Noah','CDR','#fb7185'),('Sofia','CDR','#a78bfa')) as v(first_name,last_name,color)
where not exists (select 1 from public.head_waiters h where h.first_name=v.first_name and h.last_name=v.last_name);

insert into public.tables(number,zone_id,head_waiter_id,position_x,position_y)
select lpad(n::text,2,'0'), (select id from public.zones order by display_order offset ((n-1)/18) limit 1), (select id from public.head_waiters order by first_name offset ((n-1)%6) limit 1), 0, 0
from generate_series(1,69) n on conflict (number) do nothing;

-- Même disposition que 0002, uniquement pour les tables sans position encore définie.
with numbered as (
  select t.id, z.display_order, row_number() over (partition by t.zone_id order by t.number) - 1 as n
  from public.tables t join public.zones z on z.id=t.zone_id where t.position_x=0 and t.position_y=0
)
update public.tables t set
  position_x = case n.display_order when 1 then 77+(n.n%5)*4.2 when 2 then 3+(n.n%6)*4.3 when 3 then 50+(n.n%6)*4.2 when 4 then 77+(n.n%4)*4.5 end,
  position_y = case n.display_order when 1 then 12+floor(n.n/5)*6.2 when 2 then 76+floor(n.n/6)*6.1 when 3 then 76+floor(n.n/6)*6.1 when 4 then 76+floor(n.n/4)*6.1 end
from numbered n where n.id=t.id;
