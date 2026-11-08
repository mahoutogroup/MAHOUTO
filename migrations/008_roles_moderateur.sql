-- ============================================================
-- MAHOUTO+ — 008 : rôle « modérateur », changement de rôle par le founder
-- ============================================================
--
-- Prérequis : 001 (lecture des profils restreinte), 003 et 006 (signalements
-- et colonnes de modération). À exécuter APRÈS la fusion et le déploiement de
-- la PR « feat(roles) » (les écrans affichent un message clair tant que ce
-- script n'est pas exécuté).
--
-- CE QUE FAIT CE SCRIPT
--
-- 1. profiles.is_moderator (booléen, faux par défaut) : le statut de
--    modérateur est une COLONNE SÉPARÉE, pas une nouvelle valeur de
--    profiles.role. Raison : les valeurs commerciales (premium, business,
--    organisation, formateur…) vivent dans la même colonne role ; remplacer
--    role par « moderateur » ferait perdre à un membre son statut commercial.
--    Un déclencheur de protection (trg_protect_moderator_flag) interdit à
--    tout client de la modifier (comme trg_prevent_profile_role_change le
--    fait pour role). Ces deux déclencheurs de rôle ne sont ni supprimés ni
--    modifiés.
-- 2. public.is_moderator() : vrai pour moderateur, admin, super_admin, founder.
--    public.is_founder() : vrai pour le founder. public.is_admin() n'est PAS
--    modifiée et n'inclut PAS le modérateur.
-- 3. public.role_changes : historique des changements de rôle (cible, ancien et
--    nouveau rôle, auteur, date, motif). Lisible par le founder SEUL ;
--    aucune écriture par un client (aucun droit d'écriture) : écrite
--    uniquement par la fonction ci-dessous, appelée par la route serveur.
-- 4. public.apply_role_change(...) : applique un changement et l'enregistre
--    dans role_changes, en une seule transaction. Exécutable par service_role
--    SEULEMENT (route serveur /api/admin/user-action, action « set_role »,
--    qui vérifie la session de l'appelant et exige le founder). Elle revérifie
--    elle-même les règles (défense en profondeur). Elle passe par les
--    déclencheurs de protection existants (service_role) : aucun n'est affaibli.
-- 5. Droits du modérateur, limités aux signalements de messages de SALON :
--      - lecture et mise à jour (status, admin_note ; colonnes déjà limitées
--        par la 006) des signalements kind = 'room' (nouvelles politiques,
--        les politiques existantes ne sont pas modifiées) ;
--      - public.admin_hide_room_message : accessible au modérateur, mais un
--        modérateur ne peut masquer qu'un message de salon DÉJÀ SIGNALÉ ;
--      - public.moderator_room_messages(ids) : texte du seul message de salon
--        de chaque signalement de salon demandé ;
--      - public.moderator_report_people(ids) : identifiant et pseudo (rien
--        d'autre : ni nom légal, ni pays, ni e-mail, ni rôle) des personnes
--        citées dans ces signalements de salon.
--    AUCUN accès modérateur aux signalements de messages privés ni à leur
--    message_text, aux profils (la 001 reste : chacun lit le sien), aux achats,
--    aux messages privés, ni aux pages d'administration (qui n'acceptent que
--    admin, super_admin, founder).
--
-- Aucune donnée existante n'est modifiée (nouvelle colonne à faux pour tous).
--
-- ⚠️ À EXÉCUTER MANUELLEMENT (SQL Editor Supabase). Non exécutée par cette PR.
-- Retour arrière : migrations/rollback/008_roles_moderateur.sql
-- ------------------------------------------------------------

begin;

-- 1. Colonne séparée --------------------------------------------------------

alter table public.profiles
  add column if not exists is_moderator boolean not null default false;

create or replace function public.protect_moderator_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Contexte de confiance : SQL Editor ou clé service_role (aucun utilisateur connecté).
  if auth.uid() is null or auth.role() = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.is_moderator := false;      -- une inscription n'est jamais modératrice
    return new;
  end if;

  if new.is_moderator is distinct from old.is_moderator then
    raise exception 'Modification du statut de moderateur interdite : cette operation doit passer par une route serveur autorisee.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_moderator_flag on public.profiles;
create trigger trg_protect_moderator_flag
  before insert or update on public.profiles
  for each row execute function public.protect_moderator_flag();

-- 2. Fonctions de rôle ------------------------------------------------------

create or replace function public.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (role in ('admin', 'super_admin', 'founder') or is_moderator)
  );
$$;

create or replace function public.is_founder()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'founder'
  );
$$;

revoke execute on function public.is_moderator() from public, anon;
revoke execute on function public.is_founder() from public, anon;
grant execute on function public.is_moderator() to authenticated;
grant execute on function public.is_founder() to authenticated;

-- 3. Historique des changements de rôle -------------------------------------

create table if not exists public.role_changes (
  id bigint generated always as identity primary key,
  target_id uuid not null,
  target_username text,
  old_role text not null,
  new_role text not null,
  old_moderator boolean not null,
  new_moderator boolean not null,
  changed_by uuid not null,
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists role_changes_target_idx on public.role_changes (target_id, created_at desc);

alter table public.role_changes enable row level security;
revoke all on table public.role_changes from public, anon, authenticated;
grant select on table public.role_changes to authenticated;   -- filtré par la politique du founder

drop policy if exists "role_changes_select_founder" on public.role_changes;
create policy "role_changes_select_founder" on public.role_changes
  for select to authenticated
  using (public.is_founder());

-- 4. Application d'un changement (service_role seulement) -------------------

create or replace function public.apply_role_change(
  p_caller uuid,
  p_target uuid,
  p_new_role text,
  p_new_moderator boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  target_row public.profiles%rowtype;
begin
  select role into caller_role from public.profiles where id = p_caller;
  if caller_role is distinct from 'founder' then
    raise exception 'ROLE_FOUNDER_REQUIS: reserve au fondateur' using errcode = '42501';
  end if;

  select * into target_row from public.profiles where id = p_target;
  if not found then
    raise exception 'ROLE_CIBLE_INTROUVABLE: ce membre n''existe pas' using errcode = 'P0002';
  end if;
  if p_target = p_caller then
    raise exception 'ROLE_SOI_MEME: tu ne peux pas changer ton propre role' using errcode = '42501';
  end if;
  if target_row.role in ('founder', 'super_admin') then
    raise exception 'ROLE_CIBLE_PROTEGEE: le founder et les super_admin ne se modifient pas ici' using errcode = '42501';
  end if;
  -- Valeurs attribuables : « user », « admin », ou le rôle actuel conservé (statut commercial inclus).
  if p_new_role is null or not (p_new_role in ('user', 'admin') or p_new_role = target_row.role) then
    raise exception 'ROLE_VALEUR_INVALIDE: role non attribuable' using errcode = '22023';
  end if;
  if p_new_role in ('founder', 'super_admin') then
    raise exception 'ROLE_VALEUR_INVALIDE: role non attribuable' using errcode = '22023';
  end if;
  if p_new_moderator is null then
    raise exception 'ROLE_VALEUR_INVALIDE: statut de moderateur manquant' using errcode = '22023';
  end if;
  if p_reason is not null and char_length(p_reason) > 500 then
    raise exception 'ROLE_MOTIF_TROP_LONG: motif de 500 caracteres au plus' using errcode = '22023';
  end if;
  if p_new_role = target_row.role and p_new_moderator = target_row.is_moderator then
    raise exception 'ROLE_AUCUN_CHANGEMENT: ce membre a deja ce role' using errcode = '23505';
  end if;

  update public.profiles
     set role = p_new_role, is_moderator = p_new_moderator
   where id = p_target;

  insert into public.role_changes
    (target_id, target_username, old_role, new_role, old_moderator, new_moderator, changed_by, reason)
  values
    (p_target, target_row.username, target_row.role, p_new_role, target_row.is_moderator, p_new_moderator, p_caller, nullif(btrim(p_reason), ''));

  return jsonb_build_object(
    'target_id', p_target, 'old_role', target_row.role, 'new_role', p_new_role,
    'old_moderator', target_row.is_moderator, 'new_moderator', p_new_moderator
  );
end;
$$;

revoke execute on function public.apply_role_change(uuid, uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.apply_role_change(uuid, uuid, text, boolean, text) to service_role;

-- 5. Droits du modérateur : signalements de SALON seulement -----------------

drop policy if exists "message_reports_select_moderator" on public.message_reports;
create policy "message_reports_select_moderator" on public.message_reports
  for select to authenticated
  using (kind = 'room' and public.is_moderator());

drop policy if exists "message_reports_update_moderator" on public.message_reports;
create policy "message_reports_update_moderator" on public.message_reports
  for update to authenticated
  using (kind = 'room' and public.is_moderator())
  with check (kind = 'room' and public.is_moderator());

-- Masquage d'un message de SALON : admin (tout message) ou modérateur (message déjà signalé).
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
  if not public.is_moderator() then
    raise exception 'MODERATOR_REQUIRED: reserve aux moderateurs et administrateurs'
      using errcode = '42501';
  end if;

  select m.content into old_content
  from public.messages m
  where m.id = p_message_id;

  if not found then
    raise exception 'MESSAGE_INTROUVABLE: ce message de salon n''existe pas'
      using errcode = 'P0002';
  end if;

  -- Un modérateur (non admin) ne masque qu'un message de salon déjà signalé.
  if not public.is_admin() and not exists (
    select 1 from public.message_reports r where r.kind = 'room' and r.message_id = p_message_id
  ) then
    raise exception 'SIGNALEMENT_REQUIS: un moderateur ne masque qu''un message signale'
      using errcode = '42501';
  end if;

  if coalesce(old_content, '') <> '' then
    update public.message_reports
       set message_text = old_content
     where kind = 'room' and message_id = p_message_id and message_text is null;
  end if;

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

-- Texte du seul message de salon de chaque signalement de SALON demandé.
create or replace function public.moderator_room_messages(p_report_ids bigint[])
returns table (report_id bigint, message_id bigint, content text, is_deleted boolean, attachment_type text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_moderator() then
    raise exception 'MODERATOR_REQUIRED: reserve aux moderateurs et administrateurs'
      using errcode = '42501';
  end if;
  if coalesce(array_length(p_report_ids, 1), 0) > 200 then
    raise exception 'TROP_DE_SIGNALEMENTS: 200 au plus par appel' using errcode = '22023';
  end if;

  return query
    select r.id, m.id, m.content, m.is_deleted, m.attachment_type
    from public.message_reports r
    join public.messages m on m.id = r.message_id
    where r.id = any (p_report_ids) and r.kind = 'room';
end;
$$;

-- Identifiant et pseudo des personnes citées (signalant et signalé) dans des signalements de SALON.
create or replace function public.moderator_report_people(p_report_ids bigint[])
returns table (user_id uuid, username text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_moderator() then
    raise exception 'MODERATOR_REQUIRED: reserve aux moderateurs et administrateurs'
      using errcode = '42501';
  end if;
  if coalesce(array_length(p_report_ids, 1), 0) > 200 then
    raise exception 'TROP_DE_SIGNALEMENTS: 200 au plus par appel' using errcode = '22023';
  end if;

  return query
    select p.id, p.username
    from public.profiles p
    where p.id in (
      select r.reporter_id from public.message_reports r where r.id = any (p_report_ids) and r.kind = 'room'
      union
      select r.reported_user_id from public.message_reports r where r.id = any (p_report_ids) and r.kind = 'room'
    );
end;
$$;

revoke execute on function public.moderator_room_messages(bigint[]) from public, anon;
revoke execute on function public.moderator_report_people(bigint[]) from public, anon;
grant execute on function public.moderator_room_messages(bigint[]) to authenticated;
grant execute on function public.moderator_report_people(bigint[]) to authenticated;

commit;

-- Contrôles (lecture seule) après le script :
--   select column_name, column_default from information_schema.columns
--   where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_moderator';
--   select tgname from pg_trigger where tgrelid = 'public.profiles'::regclass and not tgisinternal order by 1;
--   -- attendu : trg_prevent_profile_role_change, trg_protect_moderator_flag, trg_protect_role (et les autres)
--   select policyname from pg_policies where tablename = 'message_reports' order by 1;
--   select has_function_privilege('anon', 'public.is_admin()', 'execute');   -- inchangé
