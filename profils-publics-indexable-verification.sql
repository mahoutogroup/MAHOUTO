-- =========================================================
-- MAHOUTO+ - Profil public : VERIFICATION de profils-publics-indexable.sql
-- Lecture seule : AUCUNE ecriture. A executer a la main APRES profils-publics-indexable.sql.
-- Verdict en UNE SEULE LIGNE : toutes les colonnes doivent valoir true.
-- =========================================================

select
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'profils_publics'
             and column_name = 'indexable' and data_type = 'boolean'
             and is_nullable = 'NO') as colonne_presente_not_null,
  coalesce((select c.column_default = 'false' from information_schema.columns c
             where c.table_schema = 'public' and c.table_name = 'profils_publics'
               and c.column_name = 'indexable'), false) as defaut_false,
  coalesce(not has_column_privilege('authenticated', 'public.profils_publics', 'indexable', 'update')
    and not has_column_privilege('authenticated', 'public.profils_publics', 'indexable', 'insert')
    and not has_column_privilege('anon', 'public.profils_publics', 'indexable', 'update')
    and not has_column_privilege('anon', 'public.profils_publics', 'indexable', 'select')
    and not has_column_privilege('authenticated', 'public.profils_publics', 'indexable', 'select'),
    false) as un_membre_ne_peut_pas_la_modifier,
  exists (select 1 from pg_trigger t
           where t.tgrelid = to_regclass('public.profils_publics')
             and t.tgname = 'profils_publics_indexable_garde_trg' and not t.tgisinternal)
    as declencheur_present,
  coalesce(has_function_privilege('authenticated',
             'public.profils_publics_admin_indexable(text, boolean)', 'execute')
    and not has_function_privilege('anon',
             'public.profils_publics_admin_indexable(text, boolean)', 'execute'), false)
    as fonction_admin_protegee,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.proconfig is not null
      and p.proname in ('profils_publics_admin_indexable', 'profil_public_indexable',
                        'profil_public_sitemap')) = 3 as trois_fonctions_definer_search_path,
  coalesce(not has_function_privilege('anon', 'public.profils_publics_indexable_garde()', 'execute')
    and not has_function_privilege('authenticated', 'public.profils_publics_indexable_garde()',
                                   'execute'), false) as declencheur_sans_droit,
  coalesce(has_function_privilege('anon', 'public.profil_public_indexable(text)', 'execute')
    and has_function_privilege('anon', 'public.profil_public_sitemap()', 'execute'), false)
    as lectures_publiques_ouvertes,
  coalesce((select pg_get_function_result(p.oid) =
                  'TABLE(adresse text, modifie_le timestamp with time zone)'
              from pg_proc p where p.oid = to_regprocedure('public.profil_public_sitemap()')),
           false)
    as plan_sans_autre_colonne,
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'profil_public_lire'
                 and position('indexable' in p.prosrc) > 0) as profil_public_lire_intact;
