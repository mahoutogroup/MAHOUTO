-- =========================================================
-- MAHOUTO+ - Profil public : VERIFICATION de profils-publics-visites.sql
-- Lecture seule : AUCUNE ecriture.
--
-- A executer a la main APRES profils-publics-visites.sql.
-- La REQUETE 1 donne le verdict en UNE SEULE LIGNE : toutes les colonnes doivent
-- valoir true. La requete 2 est un detail.
-- =========================================================

-- 1. Verdict en une ligne (attendu : toutes les colonnes true)
select
  to_regprocedure('public.profil_public_visites_mien(integer)') is not null as fonction_ok,
  coalesce((select p.prosecdef and p.proconfig is not null
              from pg_proc p
             where p.oid = to_regprocedure('public.profil_public_visites_mien(integer)')),
           false) as definer_search_path_ok,
  has_function_privilege('authenticated', 'public.profil_public_visites_mien(integer)', 'execute')
    as membres_peuvent,
  not has_function_privilege('anon', 'public.profil_public_visites_mien(integer)', 'execute')
    as anon_exclu,
  not has_table_privilege('authenticated', 'public.page_views', 'select')
    as membres_sans_lecture_directe,
  not has_table_privilege('anon', 'public.page_views', 'select') as anon_sans_lecture_directe,
  coalesce((select pg_get_function_result(p.oid) not like '%visitor%'
              from pg_proc p
             where p.oid = to_regprocedure('public.profil_public_visites_mien(integer)')),
           false) as aucun_identifiant_de_visiteur;

-- 2. Colonnes renvoyees (attendu : jour, visites, qr, lien, autre)
select pg_get_function_result('public.profil_public_visites_mien(integer)'::regprocedure) as colonnes;
