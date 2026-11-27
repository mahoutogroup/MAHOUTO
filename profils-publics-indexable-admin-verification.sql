-- =========================================================
-- MAHOUTO+ - Profil public : VERIFICATION de profils-publics-indexable-admin.sql
-- Lecture seule : AUCUNE ecriture. A executer a la main APRES profils-publics-indexable-admin.sql.
-- Verdict en UNE SEULE LIGNE : toutes les colonnes doivent valoir true.
-- =========================================================

select
  to_regprocedure('public.profils_publics_admin_indexables()') is not null as fonction_existe,
  coalesce((select p.prosecdef and p.proconfig is not null
              from pg_proc p
             where p.oid = to_regprocedure('public.profils_publics_admin_indexables()')), false)
    as security_definer_search_path,
  coalesce(not has_function_privilege('anon', 'public.profils_publics_admin_indexables()', 'execute'),
           false) as anon_sans_droit,
  coalesce(has_function_privilege('authenticated', 'public.profils_publics_admin_indexables()',
                                  'execute'), false) as authenticated_avec_droit,
  coalesce((select pg_get_function_result(p.oid) = 'TABLE(adresse text)'
              from pg_proc p
             where p.oid = to_regprocedure('public.profils_publics_admin_indexables()')), false)
    as une_seule_colonne_adresse;
