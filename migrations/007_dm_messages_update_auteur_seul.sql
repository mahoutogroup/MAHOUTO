-- ============================================================
-- MAHOUTO+ — 007 : seul l'auteur modifie un message privé
-- ============================================================
--
-- ✅ DÉJÀ EXÉCUTÉE EN PRODUCTION LE 7 NOVEMBRE 2026 (à la main, dans le SQL
-- Editor Supabase), puis vérifiée par pg_policies. Ce fichier documente ce
-- qui a été exécuté et sert de référence : NE PAS LE RELANCER sans raison
-- (il est rejouable sans danger : « drop policy if exists » puis création).
--
-- Problème : la politique « dm_messages_update_own_or_admin » autorisait,
-- en UPDATE, « sender_id = auth.uid() OR is_admin() ». Un admin (founder,
-- admin, super_admin) pouvait donc modifier ou marquer supprimé N'IMPORTE
-- QUEL message privé (colonnes content, edited_at, is_deleted,
-- attachment_url, seules colonnes dont l'UPDATE est accordé aux
-- connectés), à l'aveugle puisqu'un admin ne lit pas les messages privés
-- (dm_messages_select_participants). Cela contredisait la règle : « un
-- message privé n'est jamais modifié par la modération ».
--
-- Correction : seul l'AUTEUR du message peut le modifier ou le supprimer
-- (UPDATE de ses propres lignes, USING et WITH CHECK identiques). Les autres
-- politiques de dm_messages (insert, select) et les droits de colonnes
-- (grant update (content, edited_at, is_deleted, attachment_url)) ne sont pas
-- touchés. Les fonctions SECURITY DEFINER mark_conversation_delivered /
-- mark_conversation_read (delivered_at, read_at) ne sont pas concernées : elles
-- ne passent pas par cette politique.
--
-- Aucune donnée modifiée.
-- Retour arrière : migrations/rollback/007_dm_messages_update_auteur_seul.sql
-- ------------------------------------------------------------

begin;

drop policy if exists "dm_messages_update_own_or_admin" on public.dm_messages;
drop policy if exists "dm_messages_update_own" on public.dm_messages;

create policy "dm_messages_update_own" on public.dm_messages
  for update to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

commit;

-- Contrôle (lecture seule) : UNE ligne, dm_messages_update_own, sans is_admin().
--   select policyname, cmd, roles, qual, with_check
--   from pg_policies
--   where schemaname = 'public' and tablename = 'dm_messages' and cmd in ('UPDATE', 'ALL');
