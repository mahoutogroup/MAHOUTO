-- =========================================================
-- MAHOUTO+ - Profil public : RETOUR ARRIERE de profils-publics-visiteurs.sql
--
-- Dans l ordre inverse de la creation. Chaque bloc se relance sans erreur.
-- BLOC 1 : retire les cinq fonctions (sans perte de donnees). Apres ce bloc, le code de la PR ne peut
-- plus rien enregistrer ni afficher (les appels echouent en silence cote page, la section du profil
-- indique que la fonction est indisponible). Deployez d abord le code precedent (sans la PR) avant les
-- blocs 2 et 3.
-- BLOC 2 : supprime la table des passages (confirmation requise : l historique des passages est PERDU).
-- BLOC 3 : supprime la table des preferences (confirmation requise : les choix des membres sont
-- PERDUS, tout le monde revient a desactive).
-- Aucune autre table, aucune statistique administrateur, aucune page, aucun blocage n est touche.
-- =========================================================


-- BLOC 1 - Retrait des fonctions (sans confirmation, sans perte de donnees)
drop function if exists public.profil_public_visiteurs_purger();

drop function if exists public.profil_public_visiteurs_lister();

drop function if exists public.profil_public_visiteur_reglage_ecrire(boolean);

drop function if exists public.profil_public_visiteur_reglage_lire();

drop function if exists public.profil_public_visiteur_enregistrer(text);


-- BLOC 2 - Table des passages (confirmation requise : les passages sont PERDUS)
do $$
declare
  confirmation constant text := 'NON';
  n_passages integer := 0;
begin
  if to_regclass('public.profils_publics_passages') is not null then
    execute 'select count(*) from public.profils_publics_passages' into n_passages;
  end if;
  raise warning 'ATTENTION : % passages seront PERDUS.', n_passages;
  if confirmation <> 'OUI' then
    raise exception 'Retour arriere NON confirme. Editez confirmation := OUI.';
  end if;
  drop table if exists public.profils_publics_passages;
end $$;


-- BLOC 3 - Table des preferences (confirmation requise : les choix des membres sont PERDUS)
do $$
declare
  confirmation constant text := 'NON';
  n_choix integer := 0;
begin
  if to_regclass('public.profils_publics_visiteurs_reglages') is not null then
    execute 'select count(*) from public.profils_publics_visiteurs_reglages' into n_choix;
  end if;
  raise warning 'ATTENTION : % choix de membres seront PERDUS.', n_choix;
  if confirmation <> 'OUI' then
    raise exception 'Retour arriere NON confirme. Editez confirmation := OUI.';
  end if;
  drop table if exists public.profils_publics_visiteurs_reglages;
end $$;
