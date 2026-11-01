-- =========================================================
-- Retour arrière du compteur de visites (annule page-views-setup.sql)
--
-- ► À exécuter À LA MAIN dans Supabase (SQL Editor).
-- ► ⚠ DESTRUCTIF : supprime la table page_views ET toutes les visites enregistrées.
--   Si vous voulez garder les données, exportez-les d'abord (Table Editor > Export CSV)
--   ou ne supprimez que les fonctions et la policy (lignes « drop function » et « drop policy »).
-- ► Idempotent : sans erreur si certains objets n'existent plus.
-- ► Ne touche à aucune autre table.
-- =========================================================

-- 1. Fonctions RPC et purge
drop function if exists public.admin_page_views_summary(timestamptz, timestamptz, text);
drop function if exists public.admin_page_views_top_items(timestamptz, timestamptz, text, integer);
drop function if exists public.admin_page_views_sources(timestamptz, timestamptz, text);
drop function if exists public.admin_page_views_live(text);
drop function if exists public.purge_old_page_views(integer);

-- 2. Planification pg_cron éventuelle (seulement si vous l'aviez créée ; ignorer l'erreur sinon)
--    select cron.unschedule('purge-page-views');

-- 3. Trigger, fonction du trigger, policy
drop trigger if exists page_views_guard_trg on public.page_views;
drop function if exists public.page_views_guard();
drop policy if exists "page_views_insert_public" on public.page_views;

-- 4. Table (supprime aussi ses index et contraintes)
drop table if exists public.page_views;
