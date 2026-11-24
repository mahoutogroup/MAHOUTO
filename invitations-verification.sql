-- =========================================================
-- MAHOUTO+ - Invitations : VERIFICATION de invitations.sql
-- Lecture seule : AUCUNE ecriture. A executer a la main APRES invitations.sql.
-- UNE seule requete, UNE seule ligne : toutes les colonnes doivent valoir true.
-- =========================================================

select
  to_regclass('public.invitations_codes') is not null
    and to_regclass('public.invitations_comptes_comptes') is not null as deux_tables_presentes,
  coalesce((select c.relrowsecurity from pg_class c
             where c.oid = to_regclass('public.invitations_codes')), false)
    and coalesce((select c.relrowsecurity from pg_class c
                   where c.oid = to_regclass('public.invitations_comptes_comptes')), false)
    as rls_activee,
  (select count(*) from pg_policies q
    where q.schemaname = 'public'
      and q.tablename in ('invitations_codes', 'invitations_comptes_comptes')) = 0
    as aucune_politique,
  coalesce(not has_table_privilege('anon', 'public.invitations_codes', 'select, insert, update, delete')
    and not has_table_privilege('authenticated', 'public.invitations_codes',
                                'select, insert, update, delete')
    and not has_table_privilege('anon', 'public.invitations_comptes_comptes',
                                'select, insert, update, delete')
    and not has_table_privilege('authenticated', 'public.invitations_comptes_comptes',
                                'select, insert, update, delete'), false) as aucun_droit_direct,
  (select count(*) from pg_attribute a
    where a.attrelid = to_regclass('public.invitations_comptes_comptes')
      and a.attnum > 0 and not a.attisdropped) = 2
    and exists (select 1 from pg_attribute a
                 where a.attrelid = to_regclass('public.invitations_comptes_comptes')
                   and a.attname = 'user_id')
    and exists (select 1 from pg_attribute a
                 where a.attrelid = to_regclass('public.invitations_comptes_comptes')
                   and a.attname = 'compte_le')
    as comptes_comptes_sans_colonne_vers_un_code,
  (select count(*) from pg_constraint k
    where k.conrelid = to_regclass('public.invitations_comptes_comptes') and k.contype = 'f'
      and k.confrelid <> to_regclass('auth.users')) = 0
    and (select count(*) from pg_constraint k
          where k.conrelid = to_regclass('public.invitations_comptes_comptes') and k.contype = 'f') = 1
    as une_seule_cle_etrangere_vers_auth_users,
  exists (select 1 from pg_constraint k
           where k.conrelid = to_regclass('public.invitations_codes')
             and k.conname = 'invitations_codes_format')
    and exists (select 1 from pg_constraint k
                 where k.conrelid = to_regclass('public.invitations_codes')
                   and k.conname = 'invitations_codes_borne') as formats_et_bornes_imposes,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.proconfig is not null
      and p.proname in ('invitation_mon_code', 'invitation_enregistrer', 'invitation_admin_totaux')) = 3
    as trois_fonctions_definer_search_path,
  coalesce(has_function_privilege('authenticated', 'public.invitation_mon_code()', 'execute')
    and has_function_privilege('authenticated', 'public.invitation_enregistrer(text)', 'execute')
    and has_function_privilege('authenticated', 'public.invitation_admin_totaux()', 'execute'), false)
    as membres_connectes_peuvent_appeler,
  coalesce(not has_function_privilege('anon', 'public.invitation_mon_code()', 'execute')
    and not has_function_privilege('anon', 'public.invitation_enregistrer(text)', 'execute')
    and not has_function_privilege('anon', 'public.invitation_admin_totaux()', 'execute'), false)
    as anon_ne_peut_rien_appeler,
  coalesce((select pg_get_function_result(p.oid) = 'TABLE(code text, nb_inscrits integer)'
              from pg_proc p where p.oid = to_regprocedure('public.invitation_mon_code()')), false)
    as mon_code_ne_renvoie_que_code_et_nombre,
  coalesce((select pg_get_function_result(p.oid) =
             'TABLE(nb_codes bigint, total_inscrits bigint, nb_codes_avec_inscrits bigint)'
              from pg_proc p where p.oid = to_regprocedure('public.invitation_admin_totaux()')), false)
    as totaux_administrateur_anonymes;
