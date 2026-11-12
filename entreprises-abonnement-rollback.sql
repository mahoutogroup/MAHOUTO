-- =========================================================
-- MAHOUTO+ — Abonnement des vitrines : RETOUR ARRIÈRE de entreprises-abonnement.sql
--
-- ⚠️⚠️ ATTENTION : CE FICHIER SUPPRIME les tables public.entreprise_forfaits et
--     public.entreprise_paiements (forfaits saisis, HISTORIQUE DES PAIEMENTS) ET les colonnes
--     public.entreprises.expire_le et public.entreprises.offerte (dates d'expiration, gratuités).
--     CETTE OPÉRATION EST IRRÉVERSIBLE : exportez d'abord ces données si besoin.
--     Les paiements FedaPay déjà encaissés ne sont PAS annulés chez FedaPay.
--
-- ► Remet les vitrines au comportement de entreprises-vitrine.sql : visibles dès qu'elles sont
--   publiées (plus de notion d'expiration). Les vitrines publiées redeviennent donc toutes visibles.
-- ► À exécuter À LA MAIN, après relecture. Par sécurité, il refuse de s'exécuter tant que la
--   ligne « confirmation » du §0 n'est pas passée de 'NON' à 'OUI'.
-- ► Ne supprime QUE ce que entreprises-abonnement.sql a créé. Ne touche jamais aux tables
--   entreprises / entreprise_produits / entreprise_photos (hors les 2 colonnes), ni à
--   public.is_admin(), public.serigraphie_https_only(text[]).
-- ► Relançable sans erreur. Déployez d'abord le code précédent (sans abonnement) : le code actuel
--   lit les forfaits et les paiements.
-- =========================================================


-- =========================================================
-- 0. CONFIRMATION ET AVERTISSEMENT
-- =========================================================
do $$
declare
  confirmation constant text := 'NON';   -- ← remplacez par 'OUI' pour autoriser la suppression
  n_forfaits integer := 0;
  n_paiements integer := 0;
begin
  if to_regclass('public.entreprise_forfaits') is not null then
    execute 'select count(*) from public.entreprise_forfaits' into n_forfaits;
  end if;
  if to_regclass('public.entreprise_paiements') is not null then
    execute 'select count(*) from public.entreprise_paiements' into n_paiements;
  end if;

  raise warning 'ATTENTION : % forfait(s) et % paiement(s) enregistrés, ainsi que les dates d''expiration et les gratuités, seront DÉFINITIVEMENT PERDUS.',
    n_forfaits, n_paiements;

  if confirmation <> 'OUI' then
    raise exception 'Retour arrière NON confirmé : aucune suppression effectuée. Éditez ce fichier (confirmation := ''OUI'') pour continuer.';
  end if;
end $$;


-- =========================================================
-- 1. RESTAURER les règles de visibilité de entreprises-vitrine.sql (AVANT de supprimer les colonnes)
-- =========================================================
drop policy if exists "entreprises_public_read" on public.entreprises;
create policy "entreprises_public_read" on public.entreprises
  for select to anon, authenticated
  using (published = true);

create or replace function public.entreprise_is_published(eid uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from public.entreprises e
     where e.id = eid and e.published = true
  );
$function$;

revoke all on function public.entreprise_is_published(uuid) from public;
grant execute on function public.entreprise_is_published(uuid) to anon, authenticated;


-- =========================================================
-- 2. SUPPRESSION (uniquement ce que entreprises-abonnement.sql a créé)
-- =========================================================
drop trigger if exists entreprises_abonnement_guard_trg on public.entreprises;
drop function if exists public.entreprises_abonnement_guard();

drop table if exists public.entreprise_paiements;
drop table if exists public.entreprise_forfaits;

drop function if exists public.entreprise_prolonger_manuel(uuid, integer);
drop function if exists public.entreprise_echouer_paiement(text);
drop function if exists public.entreprise_confirmer_paiement(text, integer);
drop function if exists public.entreprise_appliquer_jours(uuid, integer);
drop function if exists public.entreprise_est_visible(boolean, boolean, timestamptz);

alter table public.entreprises drop column if exists expire_le;
alter table public.entreprises drop column if exists offerte;

notify pgrst, 'reload schema';

-- Vérification (lecture seule) : doit renvoyer 0 ligne.
--   select table_name, column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'entreprises' and column_name in ('expire_le','offerte');
