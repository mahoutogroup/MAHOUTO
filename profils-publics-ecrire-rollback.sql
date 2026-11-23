-- =========================================================
-- MAHOUTO+ - Profil public : RETOUR ARRIERE de profils-publics-ecrire.sql
--
-- ATTENTION : supprime la colonne messages_ouverts (le choix des proprietaires
-- est PERDU), la table profils_publics_ecritures (le compteur des nouvelles
-- conversations) et les 3 fonctions. Irreversible pour ces donnees.
-- Les conversations deja creees dans la messagerie ne sont PAS touchees.
-- Aucune fonction existante n est modifiee.
--
-- A EXECUTER A LA MAIN, apres relecture, bloc par bloc. Le BLOC 1 refuse de
-- s executer tant que la ligne confirmation n est pas passee de NON a OUI.
-- Chaque bloc se relance sans erreur.
-- Deployez d abord le code precedent (sans la PR).
--
-- BLOCS : 1 confirmation - 2 fonctions - 3 table - 4 colonne et droits.
-- =========================================================


-- BLOC 1 - Confirmation et avertissement (ne supprime rien)
do $$
declare
  confirmation constant text := 'NON';
  n_actives integer := 0;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profils_publics'
                and column_name = 'messages_ouverts') then
    execute 'select count(*) from public.profils_publics where messages_ouverts' into n_actives;
  end if;
  raise warning 'ATTENTION : % page(s) acceptent les messages : ce choix sera PERDU.', n_actives;
  if confirmation <> 'OUI' then
    raise exception 'Retour arriere NON confirme. Editez confirmation := OUI.';
  end if;
end $$;


-- BLOC 2 - Fonctions
drop function if exists public.profil_public_ecrire(text);

drop function if exists public.profil_public_messages_ouverts(text);

drop function if exists public.profil_public_messages_mien();


-- BLOC 3 - Table du compteur
drop table if exists public.profils_publics_ecritures;


-- BLOC 4 - Droits de colonne retires, puis colonne supprimee
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profils_publics'
                and column_name = 'messages_ouverts') then
    revoke insert (messages_ouverts) on public.profils_publics from authenticated;
    revoke update (messages_ouverts) on public.profils_publics from authenticated;
  end if;
end $$;

alter table public.profils_publics drop column if exists messages_ouverts;
