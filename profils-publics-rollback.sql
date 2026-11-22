-- =========================================================
-- MAHOUTO+ - Profil public : RETOUR ARRIERE de profils-publics.sql (PR 1 sur 3)
--
-- ATTENTION : ce fichier SUPPRIME la table public.profils_publics (toutes les pages publiques et leurs adresses)
-- et l interrupteur general. CETTE OPERATION EST IRREVERSIBLE : exportez d abord ces donnees si besoin.
-- Il ne touche ni a profiles, ni aux paiements, ni a l Institut, ni a aucune autre table, ni aux pseudos reserves.
--
-- A EXECUTER A LA MAIN, apres relecture, bloc par bloc. Par securite, le BLOC 1 refuse de s executer tant que
-- la ligne confirmation n est pas passee de NON a OUI. Relancable sans erreur.
-- Deployez d abord le code precedent (sans la PR) : il n appelle plus ces fonctions ni cette table.
--
-- BLOCS : 1 confirmation et avertissement - 2 fonctions - 3 tables.
-- =========================================================


-- BLOC 1 - Confirmation et avertissement (ne supprime rien)
do $$
declare
  confirmation constant text := 'NON';
  n_pages integer := 0;
  n_publiees integer := 0;
begin
  if to_regclass('public.profils_publics') is not null then
    execute 'select count(*), count(*) filter (where publie) from public.profils_publics' into n_pages, n_publiees;
  end if;
  raise warning 'ATTENTION : % page(s) publique(s) (dont % publiee(s)) seront DEFINITIVEMENT PERDUES, adresses comprises.', n_pages, n_publiees;
  if confirmation <> 'OUI' then
    raise exception 'Retour arriere NON confirme : aucune suppression effectuee. Editez ce fichier (confirmation := OUI) pour continuer.';
  end if;
end $$;


-- BLOC 2 - Fonctions
drop function if exists public.profils_publics_admin_adresse(uuid, text);

drop function if exists public.profils_publics_admin_suspendre(uuid, boolean);

drop function if exists public.profils_publics_admin_lister();

drop function if exists public.profil_public_statut(text);

drop function if exists public.profil_public_adresse_disponible(text);

drop function if exists public.profil_public_mien();


-- BLOC 3 - Table (son declencheur et ses regles partent avec elle), fonctions de garde, puis interrupteur
drop table if exists public.profils_publics;

drop function if exists public.profils_publics_garde();

drop function if exists public.profils_publics_adresse_reservee(text);

drop function if exists public.profils_publics_ouvert();

drop table if exists public.profils_publics_reglages;
