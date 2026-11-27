-- =========================================================
-- MAHOUTO+ - Profil public : RETOUR ARRIERE de profils-publics-indexable-admin.sql
--
-- Supprime la fonction profils_publics_admin_indexables. Aucune donnee n est perdue : la colonne
-- indexable et les pages deja autorisees ne sont pas touchees. L ecran administrateur continue de
-- s afficher (sans badge ni bouton d indexation).
-- A EXECUTER A LA MAIN. Le bloc se relance sans erreur.
-- =========================================================


-- BLOC 1 - Fonction
drop function if exists public.profils_publics_admin_indexables();
