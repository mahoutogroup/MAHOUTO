-- =========================================================
-- MAHOUTO+ - Profil public : RETRAIT de profils-publics-stats.sql
--
-- Supprime les deux fonctions de statistiques (lecture seule : aucune donnee n est touchee) puis,
-- si vous l aviez cree, l index optionnel. Chaque bloc se relance sans erreur. Aucune
-- confirmation n est necessaire.
-- =========================================================


-- BLOC 1 - Fonctions
drop function if exists public.profils_publics_admin_stats_jours(integer);

drop function if exists public.profils_publics_admin_stats(integer);


-- BLOC 2 - Index optionnel (seulement si le BLOC 4 de profils-publics-stats.sql a ete execute, quelle
-- que soit la version, avec ou sans filtre sur brand)
drop index if exists public.page_views_profils_idx;
