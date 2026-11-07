-- ============================================================
-- MAHOUTO+ — 006 : modération des signalements (page admin)
-- ============================================================
--
-- Prérequis : la migration 003 (table public.message_reports) et la 001
-- (un admin lit tous les profils : la page affiche les pseudos).
--
-- Ce script ajoute :
--   1. quatre colonnes de suivi à public.message_reports :
--        status       'open' (défaut) | 'dismissed' (classé sans suite) | 'actioned' (traité)
--        handled_by   admin qui a traité le signalement (rempli par la base)
--        handled_at   date du traitement (rempli par la base)
--        admin_note   note libre de l'admin (1000 caractères au plus)
--      Les signalements EXISTANTS passent à status = 'open' ; leurs autres
--      colonnes ne sont pas touchées.
--   2. l'écriture, réservée aux admins (public.is_admin()) :
--        - GRANT UPDATE limité aux colonnes (status, handled_by, handled_at, admin_note) :
--          aucune autre colonne n'est modifiable par un client (kind, message_id,
--          reporter_id, reason, reported_user_id, message_text, created_at : non) ;
--        - politique UPDATE ... USING / WITH CHECK (public.is_admin()) ;
--        - déclencheur : handled_by et handled_at sont TOUJOURS remplis par la
--          base (auth.uid(), now()), jamais par le client, même si un admin
--          essaie de les envoyer ;
--        - aucun DELETE : pas de droit, pas de politique.
--   3. public.admin_hide_room_message(p_message_id bigint) : fonction SECURITY
--      DEFINER réservée aux admins (vérifiée en tête), qui masque un message de
--      SALON pour tout le monde, comme le fait déjà « Supprimer pour tout le
--      monde » dans chat.html (is_deleted = true, texte et pièce jointe vidés ;
--      la ligne n'est pas effacée), et passe en 'actioned' les signalements
--      ouverts de ce message.
--      Avant de vider le texte, la fonction en garde une copie dans
--      message_reports.message_text des signalements de ce message (salon
--      seulement, déclenchée par un admin, pour conserver la preuve). Écart à
--      valider : c'est le seul cas où message_text est rempli pour un salon.
--      IL N'EXISTE AUCUNE FONCTION ÉQUIVALENTE POUR LES MESSAGES PRIVÉS : un
--      signalement de message privé se classe seulement (dismissed ou
--      actioned, avec une note) ; dm_messages n'est ni lu ni modifié.
--
-- NE CHANGE AUCUNE POLITIQUE EXISTANTE (dm_messages, messages, profiles,
-- message_reports : insertion et lecture inchangées).
--
-- Les droits de table donnent update/delete aux comptes connectés : seules
-- les politiques RLS protègent. Ce script retire d'abord update/delete de
-- message_reports aux clients, puis n'accorde que les quatre colonnes.
--
-- ⚠️ À EXÉCUTER MANUELLEMENT (SQL Editor Supabase), APRÈS la fusion et le
-- déploiement de la PR (la page affiche un message clair tant que ce script
-- n'a pas été exécuté).
-- Retour arrière : migrations/rollback/006_moderation_signalements.sql
-- ------------------------------------------------------------

begin;

alter table public.message_reports
  add column if not exists status text not null default 'open',
  add column if not exists handled_by uuid references auth.users(id) on delete set null,
  add column if not exists handled_at timestamptz,
  add column if not exists admin_note text;

alter table public.message_reports
  drop constraint if exists message_reports_status_check;
alter table public.message_reports
  add constraint message_reports_status_check
  check (status in ('open', 'dismissed', 'actioned'));

alter table public.message_reports
  drop constraint if exists message_reports_admin_note_length;
alter table public.message_reports
  add constraint message_reports_admin_note_length
  check (admin_note is null or char_length(admin_note) <= 1000);

create index if not exists message_reports_status_created_idx
  on public.message_reports (status, created_at desc);

-- Droits : aucun update/delete par défaut, puis les quatre colonnes seulement.
revoke update, delete on table public.message_reports from public, anon, authenticated;
grant update (status, handled_by, handled_at, admin_note) on table public.message_reports to authenticated;

drop policy if exists "message_reports_update_admin" on public.message_reports;
create policy "message_reports_update_admin" on public.message_reports
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- handled_by / handled_at : toujours remplis par la base.
create or replace function public.set_message_report_handled()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'open' then
    new.handled_by := null;
    new.handled_at := null;
  elsif new.status is distinct from old.status then
    new.handled_by := auth.uid();
    new.handled_at := now();
  else
    new.handled_by := old.handled_by;
    new.handled_at := old.handled_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_message_report_handled on public.message_reports;
create trigger trg_message_report_handled
  before update on public.message_reports
  for each row execute function public.set_message_report_handled();

revoke execute on function public.set_message_report_handled() from public, anon, authenticated;

-- Masquage d'un message de SALON par un admin (jamais un message privé).
create or replace function public.admin_hide_room_message(p_message_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  old_content text;
  nb integer;
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED: reserve aux administrateurs'
      using errcode = '42501';
  end if;

  select m.content into old_content
  from public.messages m
  where m.id = p_message_id;

  if not found then
    raise exception 'MESSAGE_INTROUVABLE: ce message de salon n''existe pas'
      using errcode = 'P0002';
  end if;

  -- Preuve : copie du texte (salon seulement) dans les signalements de ce message,
  -- sans écraser une copie existante, avant de vider le message.
  if coalesce(old_content, '') <> '' then
    update public.message_reports
       set message_text = old_content
     where kind = 'room' and message_id = p_message_id and message_text is null;
  end if;

  -- Même effet que « Supprimer pour tout le monde » (chat.html) : la ligne reste.
  update public.messages
     set is_deleted = true, content = '', attachment_url = ''
   where id = p_message_id;

  update public.message_reports
     set status = 'actioned'
   where kind = 'room' and message_id = p_message_id and status = 'open';
  get diagnostics nb = row_count;

  return nb;
end;
$$;

revoke execute on function public.admin_hide_room_message(bigint) from public, anon;
grant execute on function public.admin_hide_room_message(bigint) to authenticated;

commit;

-- Contrôles (lecture seule), à lancer après le script :
--   select column_name, data_type, column_default
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'message_reports'
--   order by ordinal_position;
--
--   select grantee, privilege_type, column_name
--   from information_schema.column_privileges
--   where table_schema = 'public' and table_name = 'message_reports'
--     and grantee = 'authenticated' and privilege_type = 'UPDATE';
--   -- attendu : 4 lignes (status, handled_by, handled_at, admin_note)
