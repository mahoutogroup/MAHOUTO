-- =========================================================
-- MAHOUTO+ — Institut SAYÉ LOUIS : RETOUR ARRIÈRE de institut-paiements.sql (PR 4)
--
-- ⚠⚠ ATTENTION : CE FICHIER SUPPRIME la table public.institut_paiements (HISTORIQUE des paiements FedaPay de
--     l'Institut) et ses fonctions. CETTE OPÉRATION EST IRRÉVERSIBLE : exportez d'abord ces données si besoin.
--     Les paiements déjà encaissés ne sont PAS annulés chez FedaPay.
--
-- ► CE QUI RESTE : les places créées par un paiement (source « payee ») restent, mais leur source est ramenée à
--   « offerte » (BLOC 3) pour pouvoir restaurer les contraintes d'origine de institut_places : leurs codes restent
--   valables. Les lignes public.purchases créées par un paiement de petit-fils RESTENT : l'accès à la formation est
--   conservé. Ce fichier ne touche jamais à public.purchases, formations, messages, rooms, profiles, ni aux autres
--   tables de l'Institut.
-- ► À EXÉCUTER À LA MAIN, après relecture, bloc par bloc. Par sécurité, le BLOC 1 refuse de s'exécuter tant que la
--   ligne « confirmation » n'est pas passée de 'NON' à 'OUI'. Relançable sans erreur.
-- ► Déployez d'abord le code précédent (sans la PR 4) : api/_institut-paiement.js appelle ces fonctions.
--
-- BLOCS : 1 confirmation et avertissement · 2 fonctions · 3 table et contraintes de institut_places.
-- =========================================================


-- BLOC 1 — Confirmation et avertissement (ne supprime rien)
do $$
declare
  confirmation constant text := 'NON';
  n_paiements integer := 0;
  n_payes integer := 0;
  n_places integer := 0;
begin
  if to_regclass('public.institut_paiements') is not null then
    execute 'select count(*), count(*) filter (where statut = ''paye'') from public.institut_paiements' into n_paiements, n_payes;
  end if;
  select count(*) into n_places from public.institut_places where source = 'payee';
  raise warning 'ATTENTION : % paiement(s) (dont % payé(s)) seront DÉFINITIVEMENT PERDUS ; % place(s) payée(s) passeront à la source « offerte » (leurs codes restent valables). Les accès créés restent.',
    n_paiements, n_payes, n_places;
  if confirmation <> 'OUI' then
    raise exception 'Retour arrière NON confirmé : aucune suppression effectuée. Éditez ce fichier (confirmation := ''OUI'') pour continuer.';
  end if;
end $$;


-- BLOC 2 — Fonctions (la table est supprimée au BLOC 3 : les fonctions d'abord n'ont aucune dépendance déclarée)
drop function if exists public.institut_echouer_paiement(text);
drop function if exists public.institut_confirmer_paiement(text, integer);
drop function if exists public.institut_paiement_acces(uuid);
drop function if exists public.institut_paiement_place(uuid);


-- BLOC 3 — Table, puis contraintes d'origine de institut_places
drop table if exists public.institut_paiements;

update public.institut_places set source = 'offerte' where source = 'payee';

alter table public.institut_places drop constraint if exists institut_places_don_check;
alter table public.institut_places drop constraint if exists institut_places_source_check;

alter table public.institut_places
  add constraint institut_places_source_check check (source in ('don', 'offerte'));

alter table public.institut_places
  add constraint institut_places_don_check
  check ((source = 'don' and don_id is not null) or (source = 'offerte' and don_id is null));
