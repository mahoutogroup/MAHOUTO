-- =========================================================
-- MAHOUTO+ — Abonnement des salons : RETOUR ARRIÈRE de salons-abonnement.sql
--
-- ⚠️⚠️ ATTENTION : CE FICHIER SUPPRIME les tables public.salon_forfaits, public.salon_abonnements et
--     public.salon_paiements (forfaits saisis, DATES D'EXPIRATION des abonnés, HISTORIQUE DES PAIEMENTS),
--     la colonne public.rooms.abonnement, et la table de vérification public.zz_verif_salons_avant.
--     CETTE OPÉRATION EST IRRÉVERSIBLE : exportez d'abord ces données si besoin.
--     Les paiements FedaPay déjà encaissés ne sont PAS annulés chez FedaPay.
--
-- ► Les abonnés (qui n'ont pas d'achat à vie) PERDENT leur accès. Un salon qui était en mode
--   abonnement redevient un salon payant « à vie » ordinaire (prix = rooms.price, peut être vide :
--   fixez-le dans l'admin ou repassez le salon en gratuit).
-- ► Ne touche JAMAIS à public.purchases ni aux 4 règles d'origine de public.messages : les membres à vie
--   gardent leur accès avant, pendant et après ce retour arrière.
-- ► À exécuter À LA MAIN, après relecture. Par sécurité, il refuse de s'exécuter tant que la ligne
--   « confirmation » du §0 n'est pas passée de 'NON' à 'OUI'.
-- ► Relançable sans erreur. Déployez d'abord le code précédent (sans abonnement des salons).
-- =========================================================


-- =========================================================
-- 0. CONFIRMATION ET AVERTISSEMENT
-- =========================================================
do $$
declare
  confirmation constant text := 'NON';   -- ← remplacez par 'OUI' pour autoriser la suppression
  n_forfaits integer := 0;
  n_abonnements integer := 0;
  n_paiements integer := 0;
begin
  if to_regclass('public.salon_forfaits') is not null then
    execute 'select count(*) from public.salon_forfaits' into n_forfaits;
  end if;
  if to_regclass('public.salon_abonnements') is not null then
    execute 'select count(*) from public.salon_abonnements' into n_abonnements;
  end if;
  if to_regclass('public.salon_paiements') is not null then
    execute 'select count(*) from public.salon_paiements' into n_paiements;
  end if;

  raise warning 'ATTENTION : % forfait(s), % abonnement(s) et % paiement(s) enregistrés seront DÉFINITIVEMENT PERDUS.',
    n_forfaits, n_abonnements, n_paiements;

  if confirmation <> 'OUI' then
    raise exception 'Retour arrière NON confirmé : aucune suppression effectuée. Éditez ce fichier (confirmation := ''OUI'') pour continuer.';
  end if;
end $$;


-- =========================================================
-- 1. SUPPRESSION (uniquement ce que salons-abonnement.sql a créé)
-- =========================================================
-- Règles d'accès supplémentaires des abonnés (les 4 règles d'origine ne sont pas touchées)
drop policy if exists "messages_select_abonnes" on public.messages;
drop policy if exists "messages_insert_abonnes" on public.messages;
drop policy if exists "messages_update_abonnes" on public.messages;

-- Garde du mode abonnement, contrainte, colonne
drop trigger if exists rooms_abonnement_guard_trg on public.rooms;
drop function if exists public.rooms_abonnement_guard();
alter table public.rooms drop constraint if exists rooms_abonnement_requires_paid;
alter table public.rooms drop column if exists abonnement;

-- Tables (les règles RLS de ces tables disparaissent avec elles)
drop table if exists public.salon_paiements;
drop table if exists public.salon_abonnements;
drop table if exists public.salon_forfaits;
drop table if exists public.zz_verif_salons_avant;

-- Fonctions
drop function if exists public.salon_compteurs();
drop function if exists public.salon_echouer_paiement(text);
drop function if exists public.salon_confirmer_paiement(text, integer);
drop function if exists public.salon_appliquer_jours(uuid, text, integer);
drop function if exists public.salon_abonnement_actif(text);
