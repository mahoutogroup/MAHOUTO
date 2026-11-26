-- =========================================================
-- MAHOUTO+ - Profil public : RETOUR ARRIERE de profils-publics-indexable.sql
--
-- ATTENTION : supprime la colonne indexable (la liste des pages indexables est PERDUE : toutes les
-- pages redeviennent noindex), le declencheur et les 3 fonctions. Irreversible pour ces donnees.
-- Aucune fonction existante n est modifiee.
--
-- A EXECUTER A LA MAIN, apres relecture, bloc par bloc. Le BLOC 1 refuse de s executer tant que la
-- ligne confirmation n est pas passee de NON a OUI. Chaque bloc se relance sans erreur.
-- Deployez d abord le code precedent (sans la PR).
--
-- BLOCS : 1 confirmation - 2 fonctions - 3 declencheur - 4 colonne.
-- =========================================================


-- BLOC 1 - Confirmation et avertissement (ne supprime rien)
do $$
declare
  confirmation constant text := 'NON';
  n_actives integer := 0;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profils_publics'
                and column_name = 'indexable') then
    execute 'select count(*) from public.profils_publics where indexable' into n_actives;
  end if;
  raise warning 'ATTENTION : % page(s) indexable(s) : ce choix sera PERDU.', n_actives;
  if confirmation <> 'OUI' then
    raise exception 'Retour arriere NON confirme. Editez confirmation := OUI.';
  end if;
end $$;


-- BLOC 2 - Fonctions
drop function if exists public.profil_public_sitemap();

drop function if exists public.profil_public_indexable(text);

drop function if exists public.profils_publics_admin_indexable(text, boolean);


-- BLOC 3 - Declencheur et sa fonction
drop trigger if exists profils_publics_indexable_garde_trg on public.profils_publics;

drop function if exists public.profils_publics_indexable_garde();


-- BLOC 4 - Colonne
alter table public.profils_publics drop column if exists indexable;
