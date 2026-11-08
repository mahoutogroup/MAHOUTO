-- ⚠️ ATTENTION : ce script REDONNE à tout admin (founder, admin, super_admin) le droit de modifier ou marquer supprimé n'importe quel message privé (état d'avant la migration 007). À n'utiliser qu'en dernier recours.

begin;

drop policy if exists "dm_messages_update_own" on public.dm_messages;
drop policy if exists "dm_messages_update_own_or_admin" on public.dm_messages;

create policy "dm_messages_update_own_or_admin" on public.dm_messages
  for update using (sender_id = auth.uid() or is_admin())
  with check (sender_id = auth.uid() or is_admin());

commit;
