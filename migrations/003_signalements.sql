-- ============================================================
-- MAHOUTO+ — 003 : signalement minimal de messages
-- ============================================================
--
-- Ajoute public.message_reports : un utilisateur signale un message de
-- salon ou un message privé qu'il a REÇU. Rien du contenu n'est copié :
-- seulement le type (salon ou message privé), l'identifiant du message,
-- l'auteur du signalement, la raison (liste courte) et la date.
--
-- Règles appliquées par la base (RLS + contraintes) :
--   - il faut être connecté ; l'auteur du signalement est TOUJOURS
--     l'appelant (colonne reporter_id remplie par auth.uid(), non
--     modifiable : le droit d'insertion ne porte que sur kind, message_id
--     et reason) ;
--   - le message doit être lisible par l'appelant (la RLS de messages ou de
--     dm_messages s'applique dans la politique) : impossible de signaler,
--     ni de sonder, un message d'un salon payant non acheté ou d'une
--     conversation à laquelle on ne participe pas ;
--   - on ne signale pas son propre message, ni un message supprimé ;
--   - un utilisateur ne peut pas signaler deux fois le même message
--     (clé d'unicité) ;
--   - seuls les admins (public.is_admin()) peuvent LIRE les signalements ;
--     personne ne peut les modifier ni les supprimer via l'API.
--
-- Pas de blocage ni d'exclusion ici. Un admin ne peut pas lire un message
-- PRIVÉ signalé (la RLS de dm_messages ne laisse lire que les deux
-- participants) : voir la description de la PR (décision à prendre).
--
-- ⚠️ À EXÉCUTER MANUELLEMENT (SQL Editor Supabase), APRÈS le déploiement
-- du code de la PR. Non destructif (création d'une nouvelle table).
-- Retour arrière : migrations/rollback/003_signalements.sql
--
-- Lecture par un admin (SQL Editor ou compte admin), sans copier le contenu :
--   select r.created_at, r.kind, r.message_id, r.reason, r.reporter_id,
--          count(*) over (partition by r.kind, r.message_id) as nb_signalements
--   from public.message_reports r
--   order by r.created_at desc;
-- ------------------------------------------------------------

begin;

create table if not exists public.message_reports (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('room', 'dm')),
  message_id bigint not null,
  reporter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reason text not null check (reason in ('spam', 'harcelement', 'inapproprie', 'usurpation', 'arnaque', 'autre')),
  created_at timestamptz not null default now(),
  constraint message_reports_unique_per_reporter unique (kind, message_id, reporter_id)
);

create index if not exists message_reports_created_idx
  on public.message_reports (created_at desc);

alter table public.message_reports enable row level security;

revoke all on table public.message_reports from public, anon, authenticated;
grant insert (kind, message_id, reason) on table public.message_reports to authenticated;
grant select on table public.message_reports to authenticated; -- filtré par la politique admin ci-dessous

drop policy if exists "message_reports_insert_reader" on public.message_reports;
create policy "message_reports_insert_reader" on public.message_reports
  for insert to authenticated
  with check (
    reporter_id = auth.uid()
    and (
      (kind = 'room' and exists (
        select 1 from public.messages m
        where m.id = message_reports.message_id
          and m.user_id <> auth.uid()
          and not m.is_deleted
      ))
      or
      (kind = 'dm' and exists (
        select 1 from public.dm_messages d
        where d.id = message_reports.message_id
          and d.sender_id <> auth.uid()
          and not d.is_deleted
      ))
    )
  );

drop policy if exists "message_reports_select_admin" on public.message_reports;
create policy "message_reports_select_admin" on public.message_reports
  for select to authenticated
  using (public.is_admin());

commit;
