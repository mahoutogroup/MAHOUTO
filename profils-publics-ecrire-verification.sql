-- =========================================================
-- MAHOUTO+ - Profil public : VERIFICATION de profils-publics-ecrire.sql
-- Lecture seule : AUCUNE ecriture.
--
-- A executer a la main APRES profils-publics-ecrire.sql.
-- La REQUETE 1 donne le verdict en UNE SEULE LIGNE : toutes les colonnes
-- doivent valoir true. La requete 2 est un detail.
-- =========================================================

-- 1. Verdict en une ligne (attendu : toutes les colonnes true)
select
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'profils_publics'
             and column_name = 'messages_ouverts' and data_type = 'boolean'
             and is_nullable = 'NO' and column_default = 'false') as colonne_false_par_defaut,
  has_column_privilege('authenticated', 'public.profils_publics',
                       'messages_ouverts', 'insert')
    and has_column_privilege('authenticated', 'public.profils_publics',
                             'messages_ouverts', 'update')
    as proprietaire_peut_la_renseigner,
  not has_column_privilege('anon', 'public.profils_publics', 'messages_ouverts', 'select')
    and not has_column_privilege('authenticated', 'public.profils_publics',
                                 'messages_ouverts', 'select')
    as colonne_non_lisible_directement,
  coalesce((select c.relrowsecurity from pg_class c
             where c.oid = to_regclass('public.profils_publics_ecritures')), false)
    and not has_table_privilege('anon', 'public.profils_publics_ecritures',
                                'select, insert, update, delete')
    and not has_table_privilege('authenticated', 'public.profils_publics_ecritures',
                                'select, insert, update, delete') as table_verrouillee,
  not exists (select 1 from pg_policies where tablename = 'profils_publics_ecritures')
    as table_sans_regle,
  coalesce(has_function_privilege('authenticated', 'public.profil_public_ecrire(text)', 'execute')
    and not has_function_privilege('anon', 'public.profil_public_ecrire(text)', 'execute'), false)
    as ecrire_membres_seulement,
  coalesce(has_function_privilege('authenticated',
                                  'public.profil_public_messages_mien()', 'execute')
    and not has_function_privilege('anon',
                                   'public.profil_public_messages_mien()', 'execute'), false)
    as messages_mien_membres_seulement,
  coalesce(has_function_privilege('anon', 'public.profil_public_messages_ouverts(text)', 'execute')
    and has_function_privilege('authenticated', 'public.profil_public_messages_ouverts(text)', 'execute'),
    false) as messages_ouverts_anon_autorise,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.proconfig is not null
      and p.proname in ('profil_public_ecrire', 'profil_public_messages_mien',
                        'profil_public_messages_ouverts')) = 3 as trois_fonctions_definer_search_path,
  coalesce((select pg_get_function_result(p.oid) = 'TABLE(code text, conversation_id uuid)'
              from pg_proc p where p.oid = to_regprocedure('public.profil_public_ecrire(text)')),
           false) as ecrire_sans_user_id,
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public'
                 and p.proname in ('profil_public_lire', 'profil_public_mien', 'profil_public_statut',
                                   'profil_public_signaler', 'profil_public_adresse_disponible')
                 and position('messages_ouverts' in p.prosrc) > 0) as fonctions_existantes_intactes;

-- 2. Colonnes renvoyees par profil_public_ecrire (attendu : code, conversation_id)
select pg_get_function_result('public.profil_public_ecrire(text)'::regprocedure) as colonnes;
