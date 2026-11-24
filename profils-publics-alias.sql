-- =========================================================
-- MAHOUTO+ - Profil public : ALIAS d adresse (adresses supplementaires gerees par les
-- administrateurs)
--
-- Un alias est une PORTE D ENTREE : mahouto.com/m/imprimeur ouvre la page dont l adresse principale
-- est serigraphe. L adresse principale reste la seule vraie adresse : QR, lien partage, carte
-- imprimee, visites, signalements, messages et apercu proprietaire continuent de l utiliser. Seuls
-- les administrateurs creent ou retirent des alias (aucune creation libre-service). La resolution
-- est publique, mais ne renvoie QUE l adresse principale (jamais l identifiant du compte, jamais
-- une autre donnee) et seulement si la page est publiee, non suspendue et la fonction ouverte.
--
-- ADDITIF, SAUF deux points : (1) profil_public_adresse_disponible recreee (meme signature, meme
-- type de retour, ajoute : un alias existant rend l adresse prise) ; (2) un NOUVEAU declencheur sur
-- profils_publics (BLOC 8, POINT SENSIBLE) qui refuse une adresse principale egale a un alias
-- existant. Le declencheur existant profils_publics_garde_trg et sa fonction ne sont PAS modifies.
-- Aucune politique RLS modifiee. Aucune donnee supprimee ni modifiee. Aucune fonction existante
-- (profil_public_lire, signaler, ecrire, messages, visites...) n est modifiee, a l exception de
-- profil_public_adresse_disponible.
--
-- A EXECUTER A LA MAIN dans Supabase (SQL Editor), d abord sur un projet de TEST, BLOC PAR BLOC :
-- copier un bloc, l executer, passer au suivant. Chaque bloc est court, autonome et se relance sans
-- erreur. Aucun commentaire ne contient d apostrophe et tous les commentaires sont AVANT les
-- instructions. Prerequis : profils-publics.sql, profils-publics-signalement.sql
-- (profils_publics_adresse_valide) executes. A executer AVANT la fusion de la PR.
--
-- BLOCS (dans l ordre) :
--   BLOC 1 - Verification des prerequis. Ne modifie rien.
--   BLOC 2 - Table profils_publics_alias : RLS, aucune politique, aucun droit direct.
--   BLOC 3 - profils_publics_alias_pris (interne, aucun droit client).
--   BLOC 4 - Fonction du declencheur d unicite croisee (ne controle encore rien).
--   BLOC 5 - profil_public_adresse_disponible (un alias existant = adresse prise).
--   BLOC 6 - Fonctions administrateur : ajouter, retirer, lister.
--   BLOC 7 - Fonction publique : profil_public_alias_resoudre.
--   BLOC 8 - ACTIVATION du declencheur sur profils_publics (en dernier).
--
-- RETRAIT IMMEDIAT du declencheur si quelque chose se passe mal : BLOC 1 de profils-publics-alias-
-- rollback.sql (une seule instruction, sans confirmation) :
--   drop trigger if exists profils_publics_alias_garde_trg on public.profils_publics;
-- Les pages et adresses redeviennent exactement comme avant. Les alias enregistres sont gardes.
--
-- CODES : alias_ajouter = ok, invalide, reserve, deja_pris, page_introuvable, limite, non_admin.
-- alias_retirer = ok, absent, non_admin. alias_lister : aucune ligne si pas administrateur. Limite
-- : 5 alias par page.
-- =========================================================


-- BLOC 1 - Verification des prerequis (ne modifie rien)
do $$
begin
  if to_regclass('public.profils_publics') is null then
    raise exception 'Table profils_publics introuvable : executez d abord profils-publics.sql';
  end if;
  if to_regprocedure('public.profils_publics_adresse_valide(text)') is null then
    raise exception 'profils_publics_adresse_valide introuvable : profils-publics-signalement.sql';
  end if;
  if to_regprocedure('public.profils_publics_adresse_reservee(text)') is null
     or to_regprocedure('public.profils_publics_ouvert()') is null
     or to_regprocedure('public.profil_public_adresse_disponible(text)') is null
     or to_regprocedure('public.profil_public_lire(text)') is null
     or to_regprocedure('public.is_admin()') is null then
    raise exception 'Fonctions des profils publics ou is_admin introuvables';
  end if;
end $$;


-- BLOC 2 - Table des alias : aucune politique, aucun droit direct, tout passe par les fonctions
create table if not exists public.profils_publics_alias (
  alias text primary key,
  page_id uuid not null references public.profils_publics(id) on delete cascade,
  cree_le timestamptz not null default now(),
  cree_par uuid,
  constraint profils_publics_alias_longueur check (char_length(alias) between 3 and 30)
);

create index if not exists profils_publics_alias_page_idx on public.profils_publics_alias (page_id);

alter table public.profils_publics_alias enable row level security;

revoke all on public.profils_publics_alias from public;

revoke all on public.profils_publics_alias from anon, authenticated;


-- BLOC 3 - Fonction INTERNE : cette adresse est-elle deja un alias ?
create or replace function public.profils_publics_alias_pris(p_adresse text)
 returns boolean
 language sql
 stable
 security definer
 set search_path = public, pg_temp
as $$
  select exists (select 1 from public.profils_publics_alias a where a.alias = p_adresse);
$$;

revoke all on function public.profils_publics_alias_pris(text) from public, anon, authenticated;


-- BLOC 4 - Fonction du declencheur : refuse une adresse principale egale a un alias existant
-- Meme verrou advisory que la creation d un alias : pas de course entre une page et un alias.
-- Elle ne s execute que si l adresse change. Le code 23505 reutilise le message existant adresse
-- deja prise.
create or replace function public.profils_publics_alias_garde()
 returns trigger
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.adresse is not distinct from old.adresse then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ppa:' || coalesce(new.adresse, ''), 0));
  if exists (select 1 from public.profils_publics_alias a where a.alias = new.adresse) then
    raise exception 'Cette adresse est deja prise : choisissez-en une autre.' using errcode = '23505';
  end if;
  return new;
end;
$$;

revoke all on function public.profils_publics_alias_garde() from public, anon, authenticated;


-- BLOC 5 - profil_public_adresse_disponible : identique a la version actuelle, plus l alias
-- existant = prise
create or replace function public.profil_public_adresse_disponible(p_adresse text)
 returns text
 language plpgsql
 stable
 security definer
 set search_path = public, pg_temp
as $$
declare
  v record;
begin
  if p_adresse is null or p_adresse !~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$' then
    return 'invalide';
  end if;
  select p.user_id into v from public.profils_publics p where p.adresse = p_adresse;
  if found then
    if v.user_id = auth.uid() then
      return 'libre';
    end if;
    return 'prise';
  end if;
  if public.profils_publics_alias_pris(p_adresse) then
    return 'prise';
  end if;
  if public.profils_publics_adresse_reservee(p_adresse) then
    return 'reservee';
  end if;
  return 'libre';
end;
$$;

revoke all on function public.profil_public_adresse_disponible(text) from public, anon;

grant execute on function public.profil_public_adresse_disponible(text) to authenticated;


-- BLOC 6 - Fonctions administrateur : ajouter, retirer, lister (refus immediat si pas is_admin)
create or replace function public.profils_publics_admin_alias_ajouter(p_alias text, p_adresse_page text)
 returns text
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $$
declare
  v_alias text := lower(btrim(coalesce(p_alias, '')));
  v_adresse text := lower(btrim(coalesce(p_adresse_page, '')));
  v_page record;
  v_n integer;
begin
  if not public.is_admin() then
    return 'non_admin';
  end if;
  if not public.profils_publics_adresse_valide(v_alias) then
    return 'invalide';
  end if;
  if public.profils_publics_adresse_reservee(v_alias) then
    return 'reserve';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ppa:' || v_alias, 0));
  if exists (select 1 from public.profils_publics p where p.adresse = v_alias)
     or exists (select 1 from public.profils_publics_alias a where a.alias = v_alias) then
    return 'deja_pris';
  end if;
  select p.id into v_page from public.profils_publics p where p.adresse = v_adresse;
  if not found then
    return 'page_introuvable';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ppap:' || v_page.id::text, 0));
  select count(*) into v_n from public.profils_publics_alias a where a.page_id = v_page.id;
  if v_n >= 5 then
    return 'limite';
  end if;
  insert into public.profils_publics_alias (alias, page_id, cree_par)
  values (v_alias, v_page.id, auth.uid());
  return 'ok';
end;
$$;

revoke all on function public.profils_publics_admin_alias_ajouter(text, text) from public, anon;

grant execute on function public.profils_publics_admin_alias_ajouter(text, text) to authenticated;

create or replace function public.profils_publics_admin_alias_retirer(p_alias text)
 returns text
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  if not public.is_admin() then
    return 'non_admin';
  end if;
  delete from public.profils_publics_alias a
   where a.alias = lower(btrim(coalesce(p_alias, '')));
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return 'absent';
  end if;
  return 'ok';
end;
$$;

revoke all on function public.profils_publics_admin_alias_retirer(text) from public, anon;

grant execute on function public.profils_publics_admin_alias_retirer(text) to authenticated;

create or replace function public.profils_publics_admin_alias_lister()
 returns table (alias text, adresse text, cree_le timestamptz)
 language plpgsql
 stable
 security definer
 set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    return;
  end if;
  return query
    select a.alias, p.adresse, a.cree_le
      from public.profils_publics_alias a
      join public.profils_publics p on p.id = a.page_id
     order by a.alias;
end;
$$;

revoke all on function public.profils_publics_admin_alias_lister() from public, anon;

grant execute on function public.profils_publics_admin_alias_lister() to authenticated;


-- BLOC 7 - Fonction publique : l adresse principale d un alias, seulement si la page est reellement
-- publique
-- Memes droits que profil_public_lire. Ne renvoie jamais autre chose que l adresse principale.
create or replace function public.profil_public_alias_resoudre(p_alias text)
 returns text
 language sql
 stable
 security definer
 set search_path = public, pg_temp
as $$
  select p.adresse
    from public.profils_publics_alias a
    join public.profils_publics p on p.id = a.page_id
   where public.profils_publics_adresse_valide(p_alias)
     and a.alias = p_alias
     and p.publie
     and not p.suspendu
     and public.profils_publics_ouvert()
   limit 1;
$$;

revoke all on function public.profil_public_alias_resoudre(text) from public;

grant execute on function public.profil_public_alias_resoudre(text) to anon, authenticated;


-- BLOC 8 - ACTIVATION du declencheur sur profils_publics (a executer EN DERNIER)
-- Retrait immediat : drop trigger if exists profils_publics_alias_garde_trg on
-- public.profils_publics;
drop trigger if exists profils_publics_alias_garde_trg on public.profils_publics;

create trigger profils_publics_alias_garde_trg
  before insert or update of adresse on public.profils_publics
  for each row execute function public.profils_publics_alias_garde();
