-- Correctif de sécurité : les profils ne doivent pas être lisibles librement.
alter table public.profiles enable row level security;
create policy "users read own profile" on public.profiles for select to authenticated using (id = auth.uid());
create policy "admin reads profiles" on public.profiles for select to authenticated using (public.current_role() = 'admin');
