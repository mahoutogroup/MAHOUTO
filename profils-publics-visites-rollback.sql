-- =========================================================
-- MAHOUTO+ - Profil public : RETOUR ARRIERE de profils-publics-visites.sql (PR 3 sur 3)
--
-- Supprime seulement la fonction profil_public_visites_mien. Aucune donnee n est
-- perdue : page_views et les visites deja enregistrees ne sont pas touchees.
-- Relancable sans erreur.
-- Deployez d abord le code precedent (sans la PR) : il n appelle plus cette fonction.
-- =========================================================


-- BLOC 1 - Suppression de la fonction
drop function if exists public.profil_public_visites_mien(integer);
