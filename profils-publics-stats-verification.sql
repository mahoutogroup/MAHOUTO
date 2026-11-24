-- =========================================================
-- MAHOUTO+ - Profil public : VERIFICATION de profils-publics-stats.sql
-- Lecture seule : AUCUNE ecriture.
--
-- A executer a la main APRES profils-publics-stats.sql. La REQUETE 1 donne le verdict en UNE
-- SEULE LIGNE : toutes les colonnes doivent valoir true. La requete 2 indique si l index
-- optionnel existe (information, pas un verdict).
-- =========================================================

-- 1. Verdict en une ligne (attendu : toutes les colonnes true)
select
  to_regprocedure('public.profils_publics_admin_stats(integer)') is not null
    and to_regprocedure('public.profils_publics_admin_stats_jours(integer)') is not null
    as deux_fonctions_presentes,
  coalesce(has_function_privilege('authenticated',
             'public.profils_publics_admin_stats(integer)', 'execute')
    and has_function_privilege('authenticated',
             'public.profils_publics_admin_stats_jours(integer)', 'execute'), false)
    as membres_connectes_autorises,
  coalesce(not has_function_privilege('anon',
             'public.profils_publics_admin_stats(integer)', 'execute')
    and not has_function_privilege('anon',
             'public.profils_publics_admin_stats_jours(integer)', 'execute'), false)
    as visiteurs_non_connectes_refuses,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.proconfig is not null
      and p.provolatile = 's'
      and p.proname in ('profils_publics_admin_stats', 'profils_publics_admin_stats_jours')) = 2
    as definer_search_path_et_stable,
  coalesce((select position('is_admin()' in p.prosrc) > 0
              and position('is_admin()' in p.prosrc) < position('select' in p.prosrc)
              from pg_proc p
             where p.oid = to_regprocedure('public.profils_publics_admin_stats(integer)')),
           false) as stats_refuse_sans_is_admin,
  coalesce((select position('is_admin()' in p.prosrc) > 0
              and position('is_admin()' in p.prosrc) < position('select' in p.prosrc)
              from pg_proc p
             where p.oid = to_regprocedure('public.profils_publics_admin_stats_jours(integer)')),
           false) as jours_refuse_sans_is_admin,
  coalesce((select position('least(greatest(coalesce(p_jours, 30), 1), 365)' in p.prosrc) > 0
              from pg_proc p
             where p.oid = to_regprocedure('public.profils_publics_admin_stats(integer)')),
           false)
    and coalesce((select position('least(greatest(coalesce(p_jours, 30), 1), 365)' in p.prosrc) > 0
              from pg_proc p
             where p.oid = to_regprocedure('public.profils_publics_admin_stats_jours(integer)')),
           false) as periode_bornee_1_365,
  coalesce((select position('user_id' in lower(p.prosrc)) = 0
                   and position('visitor_id' in lower(p.prosrc)) = 0
                   and position('contact' in lower(p.prosrc)) = 0
                   and position('user_id' in pg_get_function_result(p.oid)) = 0
              from pg_proc p
             where p.oid = to_regprocedure('public.profils_publics_admin_stats(integer)')),
           false) as stats_sans_identifiant_ni_contact,
  coalesce((select position('user_id' in lower(p.prosrc)) = 0
                   and position('visitor_id' in lower(p.prosrc)) = 0
                   and position('user_id' in pg_get_function_result(p.oid)) = 0
              from pg_proc p
             where p.oid = to_regprocedure('public.profils_publics_admin_stats_jours(integer)')),
           false) as jours_sans_identifiant,
  coalesce((select position('insert into' in lower(p.prosrc)) = 0
                   and position('update ' in lower(p.prosrc)) = 0
                   and position('delete ' in lower(p.prosrc)) = 0
                   and position('truncate' in lower(p.prosrc)) = 0
              from pg_proc p
             where p.oid = to_regprocedure('public.profils_publics_admin_stats(integer)')),
           false)
    and coalesce((select position('insert into' in lower(p.prosrc)) = 0
                   and position('update ' in lower(p.prosrc)) = 0
                   and position('delete ' in lower(p.prosrc)) = 0
              from pg_proc p
             where p.oid = to_regprocedure('public.profils_publics_admin_stats_jours(integer)')),
           false) as lecture_seule,
  coalesce((select pg_get_function_result(p.oid) =
             'TABLE(pages_total integer, pages_publiees integer, pages_brouillon integer, '
             || 'pages_suspendues integer, pages_nouvelles_7j integer, pages_nouvelles_30j integer, '
             || 'pages_messages_ouverts integer, alias_total integer, signalements_a_examiner integer, '
             || 'signalements_non_traites integer, visites_total bigint, visites_periode bigint, '
             || 'visites_par_source jsonb, top_pages jsonb)'
              from pg_proc p
             where p.oid = to_regprocedure('public.profils_publics_admin_stats(integer)')),
           false) as colonnes_attendues;

-- 2. Index optionnel (information)
select exists (select 1 from pg_indexes
                where schemaname = 'public' and indexname = 'page_views_profils_idx')
  as index_optionnel_cree;
