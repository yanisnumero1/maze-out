-- Chaque nouvel utilisateur Auth reçoit un profil sans privilège par défaut.
create or replace function public.handle_new_auth_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles (id, role, first_name, last_name)
  values (new.id, 'observer', new.raw_user_meta_data->>'first_name', new.raw_user_meta_data->>'last_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();

-- Rattrape sans doublon les utilisateurs éventuellement créés avant le trigger.
insert into public.profiles (id, role)
select u.id, 'observer' from auth.users u
where not exists (select 1 from public.profiles p where p.id=u.id);
