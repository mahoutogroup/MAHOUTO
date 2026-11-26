-- =========================================================
-- MAHOUTO+ - Profil public : INDEXATION par les moteurs de recherche, page par page
--
-- Par defaut toutes les pages /m/adresse restent en noindex. Une page n est indexable que si un
-- ADMINISTRATEUR l a decide (colonne indexable, false par defaut) ET si elle est publiee, non
-- suspendue et si l interrupteur des pages publiques est ouvert. Aucune case pour les membres.
--
-- Protection de la colonne, en deux couches : (1) aucun droit de colonne pour anon et authenticated
-- (les listes grant update et grant insert existantes ne la contiennent pas) ; (2) un declencheur
-- refuse toute valeur differente de false, sauf pour un administrateur ou le serveur. Seule la
-- fonction profils_publics_admin_indexable (administrateurs) la change, ou une modification
-- manuelle dans l editeur SQL (voir la requete en fin de fichier).
--
-- Lectures publiques : profil_public_indexable(adresse) renvoie un booleen, profil_public_sitemap()
-- renvoie adresse et date de modification des seules pages indexables. Aucune colonne n est
-- ajoutee a profil_public_lire. Aucune donnee nouvelle n est exposee.
--
-- ADDITIF : une colonne, un declencheur, 3 fonctions. Rien d existant n est modifie.
--
-- A EXECUTER A LA MAIN dans Supabase (SQL Editor), BLOC PAR BLOC, d abord sur un projet de TEST.
-- Chaque bloc est court, autonome et se relance sans erreur. Aucun commentaire ne contient
-- d apostrophe et tous les commentaires sont AVANT les instructions.
-- Prerequis : profils-publics.sql deja execute. A executer AVANT la fusion de la PR.
--
-- BLOCS : 1 prerequis - 2 colonne - 3 droits - 4 declencheur - 5 fonction administrateur
--         6 lecture publique booleenne - 7 lecture publique du plan du site.
--
-- Activation : profils-publics-indexable-activer.sql.
-- Retour arriere : profils-publics-indexable-rollback.sql.
-- Verification : profils-publics-indexable-verification.sql.
-- =========================================================


-- BLOC 1 - Verification des prerequis (ne modifie rien)
do $$
begin
  if to_regclass('public.profils_publics') is null then
    raise exception 'Table profils_publics introuvable : executez d abord profils-publics.sql';
  end if;
  if to_regprocedure('public.profils_publics_ouvert()') is null
     or to_regprocedure('public.is_admin()') is null then
    raise exception 'Fonctions profils_publics_ouvert ou is_admin introuvables';
  end if;
end $$;


-- BLOC 2 - Colonne indexable : false par defaut, jamais vide
alter table public.profils_publics
  add column if not exists indexable boolean not null default false;


-- BLOC 3 - Aucun droit de colonne pour les membres ni pour anon (securite en plus, sans effet si absent)
revoke insert (indexable) on public.profils_publics from anon, authenticated;

revoke update (indexable) on public.profils_publics from anon, authenticated;

revoke select (indexable) on public.profils_publics from anon, authenticated;


-- BLOC 4 - Declencheur : seule une valeur false passe pour un membre ; administrateur et serveur libres
create or replace function public.profils_publics_indexable_garde()
 returns trigger
 language plpgsql
 set search_path = public, pg_temp
as $$
declare
  v_libre boolean := (auth.uid() is null) or (coalesce(auth.role(), '') = 'service_role')
                     or public.is_admin();
begin
  if v_libre then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.indexable then
      raise exception 'Le champ indexable est reserve aux administrateurs.';
    end if;
    return new;
  end if;
  if new.indexable is distinct from old.indexable then
    raise exception 'Le champ indexable est reserve aux administrateurs.';
  end if;
  return new;
end;
$$;

revoke all on function public.profils_publics_indexable_garde() from public, anon, authenticated;

drop trigger if exists profils_publics_indexable_garde_trg on public.profils_publics;

create trigger profils_publics_indexable_garde_trg
  before insert or update on public.profils_publics
  for each row execute function public.profils_publics_indexable_garde();


-- BLOC 5 - Fonction des administrateurs : activer ou retirer l indexation d une page par son adresse
-- Renvoie true si la page existe. Les membres et anon n ont aucun droit d execution.
create or replace function public.profils_publics_admin_indexable(
  p_adresse text, p_indexable boolean)
 returns boolean
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  if not public.is_admin() then
    raise exception 'Reserve aux administrateurs.';
  end if;
  if p_indexable is null then
    raise exception 'Valeur obligatoire.';
  end if;
  update public.profils_publics set indexable = p_indexable where adresse = p_adresse;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

revoke all on function public.profils_publics_admin_indexable(text, boolean) from public, anon;

grant execute on function public.profils_publics_admin_indexable(text, boolean) to authenticated;


-- BLOC 6 - Lecture publique : cette page est-elle indexable ? true seulement si publiee, non suspendue,
-- interrupteur ouvert et indexable. Toute autre situation renvoie false, sans distinction.
create or replace function public.profil_public_indexable(p_adresse text)
 returns boolean
 language sql
 stable
 security definer
 set search_path = public, pg_temp
as $$
  select coalesce((
    select true
      from public.profils_publics p
     where p_adresse ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'
       and p.adresse = p_adresse
       and p.publie
       and not p.suspendu
       and p.indexable
       and public.profils_publics_ouvert()
     limit 1), false);
$$;

revoke all on function public.profil_public_indexable(text) from public;

grant execute on function public.profil_public_indexable(text) to anon, authenticated;


-- BLOC 7 - Lecture publique : plan du site (adresse et date de modification des pages indexables)
-- Au plus 500 lignes. Aucune autre colonne.
create or replace function public.profil_public_sitemap()
 returns table (adresse text, modifie_le timestamptz)
 language sql
 stable
 security definer
 set search_path = public, pg_temp
as $$
  select p.adresse, p.modifie_le
    from public.profils_publics p
   where p.publie
     and not p.suspendu
     and p.indexable
     and public.profils_publics_ouvert()
   order by p.adresse
   limit 500;
$$;

revoke all on function public.profil_public_sitemap() from public;

grant execute on function public.profil_public_sitemap() to anon, authenticated;


-- =========================================================
-- ACTIVER UNE PAGE : voir profils-publics-indexable-activer.sql (fichier separe, volontaire)
-- =========================================================
