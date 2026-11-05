-- ⚠️ ATTENTION : ce script ROUVRE la lecture de tous les profils (nom légal, pays, rôle) à tout compte connecté, y compris anonyme. À n'utiliser qu'en cas de problème.

begin;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated" on public.profiles
  for select using (auth.role() = 'authenticated');

commit;
