-- =========================================================
-- MAHOUTO+ — Institut SAYÉ LOUIS : RETOUR ARRIÈRE de institut-places.sql (PR 3)
--
-- ⚠⚠ ATTENTION : CE FICHIER SUPPRIME les tables public.institut_places (places et CODES D'INVITATION),
--     public.institut_dons (dons enregistrés), public.institut_formations (formations proposées et prix Institut) et
--     public.institut_tentatives, ainsi que leurs fonctions. CETTE OPÉRATION EST IRRÉVERSIBLE : exportez d'abord
--     ces données si besoin. Les codes non réclamés ne pourront plus être utilisés.
--
-- ► LES ACHATS DÉJÀ CRÉÉS RESTENT : chaque code réclamé a créé une ligne dans public.purchases (montant 0, statut
--   « paid », type « formation »). Ce fichier n'y touche JAMAIS : les élèves déjà inscrits GARDENT leur accès à la
--   formation. Seul le lien entre ces achats et les codes disparaît (la table institut_places).
-- ► Ne touche jamais à public.formations, public.purchases, messages, rooms, profiles, ni aux tables des PR 1 et 2
--   (institut_contenus, institut_demandes, institut_petits_fils, bucket institut-justificatifs), ni à public.is_admin().
-- ► À EXÉCUTER À LA MAIN, après relecture, bloc par bloc. Par sécurité, le BLOC 1 refuse de s'exécuter tant que la
--   ligne « confirmation » n'est pas passée de 'NON' à 'OUI'. Relançable sans erreur.
-- ► Déployez d'abord le code précédent (sans la PR 3) : les pages lisent ces tables et appellent ces fonctions.
--
-- BLOCS : 1 confirmation et avertissement · 2 tables · 3 fonctions.
-- =========================================================


-- BLOC 1 — Confirmation et avertissement (ne supprime rien)
do $$
declare
  confirmation constant text := 'NON';
  n_places integer := 0;
  n_reclamees integer := 0;
  n_dons integer := 0;
begin
  if to_regclass('public.institut_places') is not null then
    execute 'select count(*), count(reclamee_le) from public.institut_places' into n_places, n_reclamees;
  end if;
  if to_regclass('public.institut_dons') is not null then
    execute 'select count(*) from public.institut_dons' into n_dons;
  end if;
  raise warning 'ATTENTION : % place(s) (dont % déjà réclamée(s)) et % don(s) seront DÉFINITIVEMENT PERDUS. Les achats déjà créés pour les élèves restent dans public.purchases.',
    n_places, n_reclamees, n_dons;
  if confirmation <> 'OUI' then
    raise exception 'Retour arrière NON confirmé : aucune suppression effectuée. Éditez ce fichier (confirmation := ''OUI'') pour continuer.';
  end if;
end $$;


-- BLOC 2 — Tables (leurs règles, index et déclencheurs disparaissent avec elles ; ordre : places, dons, formations)
drop table if exists public.institut_places;
drop table if exists public.institut_tentatives;
drop table if exists public.institut_dons;
drop table if exists public.institut_formations;


-- BLOC 3 — Fonctions
drop function if exists public.institut_reclamer_place(text);
drop function if exists public.institut_attribuer_place(uuid, text, text, uuid);
drop function if exists public.institut_stats();
drop function if exists public.institut_code_genere();
drop function if exists public.institut_dons_garde();
drop function if exists public.institut_formations_maj();
