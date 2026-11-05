-- ============================================================
-- MAHOUTO+ — 003 : signalement de messages (salons et messages privés)
-- ============================================================
--
-- Ajoute public.message_reports : un utilisateur signale un message de
-- salon ou un message privé qu'il a REÇU.
--
-- Ce qui est enregistré :
--   - toujours : le type (salon ou message privé), l'identifiant du
--     message, l'auteur du signalement, la raison (liste courte), la date,
--     et l'identifiant de la personne signalée (auteur du message) ;
--   - pour un MESSAGE PRIVÉ seulement : une COPIE DU TEXTE de ce seul
--     message, prise par la base au moment du signalement (colonne
--     message_text, remplie par un déclencheur : le navigateur ne peut ni
--     l'écrire ni la modifier). Les pages affichent avant l'envoi
--     l'avertissement : « En signalant, vous partagez ce message avec
--     l'équipe de modération. »
--     Pour un message de salon, aucun texte n'est copié (un admin lit déjà
--     les salons).
--
-- Règles appliquées par la base (RLS + contraintes + déclencheur) :
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
-- AUCUNE AUTRE LECTURE DES MESSAGES PRIVÉS : la RLS de dm_messages reste
-- inchangée (seuls les deux participants lisent) ; il n'y a aucune fonction
-- de lecture pour les admins ; le déclencheur ci-dessous ne lit QUE le
-- message signalé, par son identifiant, et déjà vérifié lisible par
-- l'auteur du signalement.
--
-- Pas de blocage ni d'exclusion ici.
--
-- ⚠️ À EXÉCUTER MANUELLEMENT (SQL Editor Supabase), APRÈS le déploiement
-- du code de la PR (qui affiche l'avertissement avant l'envoi). Non
-- destructif (création d'une nouvelle table).
-- Retour arrière : migrations/rollback/003_signalements.sql
--
-- Lecture par un admin (SQL Editor ou compte admin) :
--   select r.created_at, r.kind, r.message_id, r.reason, r.reporter_id,
--          r.reported_user_id, r.message_text,
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
  reported_user_id uuid,
  message_text text,
  constraint message_reports_unique_per_reporter unique (kind, message_id, reporter_id)
);

create index if not exists message_reports_created_idx
  on public.message_reports (created_at desc);

alter table public.message_reports enable row level security;

revoke all on table public.message_reports from public, anon, authenticated;
-- Le client n'écrit que le type, l'identifiant et la raison : reporter_id, la date,
-- reported_user_id et message_text sont remplis par la base.
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

-- Instantané pris par la base : auteur du message et, pour un message privé, son texte.
-- SECURITY DEFINER pour lire dm_messages malgré la RLS, mais UNIQUEMENT le message signalé
-- (la politique d'insertion a déjà vérifié que l'auteur du signalement peut le lire).
create or replace function public.fill_message_report_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.reported_user_id := null;
  new.message_text := null;

  if new.kind = 'dm' then
    select d.sender_id, d.content
      into new.reported_user_id, new.message_text
    from public.dm_messages d
    where d.id = new.message_id;
  elsif new.kind = 'room' then
    select m.user_id
      into new.reported_user_id
    from public.messages m
    where m.id = new.message_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_message_report_snapshot on public.message_reports;
create trigger trg_message_report_snapshot
  before insert on public.message_reports
  for each row execute function public.fill_message_report_snapshot();

revoke execute on function public.fill_message_report_snapshot() from public, anon, authenticated;

commit;
