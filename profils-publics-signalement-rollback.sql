-- =========================================================
-- MAHOUTO+ - Profil public : RETOUR ARRIERE de profils-publics-signalement.sql (PR 2 sur 3)
--
-- ATTENTION : ce fichier SUPPRIME la table public.profils_publics_signalements (tous les signalements de pages
-- publiques, traites ou non) et ses fonctions. CETTE OPERATION EST IRREVERSIBLE : exportez les donnees avant si besoin.
-- Il ne touche ni aux pages publiques, ni a message_reports, ni a aucune autre table.
--
-- A EXECUTER A LA MAIN, apres relecture, bloc par bloc. Par securite, le BLOC 1 refuse de s executer tant que
-- la ligne confirmation n est pas passee de NON a OUI. Relancable sans erreur.
-- Deployez d abord le code precedent (sans la PR) : il n appelle plus ces fonctions.
--
-- BLOCS : 1 confirmation et avertissement - 2 fonctions - 3 table.
-- =========================================================


-- BLOC 1 - Confirmation et avertissement (ne supprime rien)
do $$
declare
  confirmation constant text := 'NON';
  n_total integer := 0;
  n_ouverts integer := 0;
begin
  if to_regclass('public.profils_publics_signalements') is not null then
    execute 'select count(*), count(*) filter (where not traite) from public.profils_publics_signalements'
      into n_total, n_ouverts;
  end if;
  raise warning 'ATTENTION : % signalement(s) (dont % non traite(s)) seront DEFINITIVEMENT PERDUS.', n_total, n_ouverts;
  if confirmation <> 'OUI' then
    raise exception 'Retour arriere NON confirme : aucune suppression. Editez confirmation := OUI.';
  end if;
end $$;


-- BLOC 2 - Fonctions
drop function if exists public.profils_publics_signalements_admin_traiter(uuid);

drop function if exists public.profils_publics_signalements_admin_detail(uuid);

drop function if exists public.profils_publics_signalements_admin_lister();

drop function if exists public.profil_public_signaler(text, text, text);

drop function if exists public.profils_publics_adresse_valide(text);


-- BLOC 3 - Table (ses contraintes, index et regles partent avec elle)
drop table if exists public.profils_publics_signalements;
