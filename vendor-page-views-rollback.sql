-- =========================================================
-- Retour arrière de « Mes statistiques » du vendeur (annule vendor-page-views.sql)
--
-- ► À exécuter À LA MAIN dans Supabase (SQL Editor).
-- ► Ne supprime QUE la fonction vendor_page_views_summary : la table page_views, ses données et les
--   fonctions admin ne sont pas touchées. Idempotent.
-- ► Après ce retour arrière, la section « Mes statistiques » de serigraphie-vendeur.html affiche
--   un message d'indisponibilité (sans casser la page).
-- =========================================================
drop function if exists public.vendor_page_views_summary(timestamptz, timestamptz);
