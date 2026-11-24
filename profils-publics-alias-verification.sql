-- =========================================================
-- MAHOUTO+ - Profil public : VERIFICATION de profils-publics-alias.sql Lecture seule : AUCUNE
-- ecriture.
--
-- A executer a la main APRES profils-publics-alias.sql. La REQUETE 1 donne le verdict en UNE SEULE
-- LIGNE : toutes les colonnes doivent valoir true. La requete 2 est un detail.
-- =========================================================

-- 1. Verdict en une ligne (attendu : toutes les colonnes true)
select
  coalesce((select c.relrowsecurity from pg_class c
             where c.oid = to_regclass('public.profils_publics_alias')), false) as table_avec_rls,
  not exists (select 1 from pg_policies q where q.tablename = 'profils_publics_alias')
    as table_sans_politique,
  not has_table_privilege('anon', 'public.profils_publics_alias', 'select, insert, update, delete')
    and not has_table_privilege('authenticated', 'public.profils_publics_alias',
                                'select, insert, update, delete') as aucun_droit_direct,
  exists (select 1 from pg_constraint k
           where k.conrelid = to_regclass('public.profils_publics_alias') and k.contype = 'p')
    as alias_cle_primaire,
  exists (select 1 from pg_constraint k
           where k.conrelid = to_regclass('public.profils_publics_alias') and k.contype = 'f'
             and k.confdeltype = 'c' and k.confrelid = to_regclass('public.profils_publics'))
    as suppression_en_cascade,
  coalesce(not has_function_privilege('anon', 'public.profils_publics_alias_pris(text)', 'execute')
    and not has_function_privilege('authenticated', 'public.profils_publics_alias_pris(text)', 'execute')
    and not has_function_privilege('authenticated', 'public.profils_publics_alias_garde()', 'execute'),
    false) as fonctions_internes_sans_droit_client,
  coalesce(has_function_privilege('authenticated',
             'public.profils_publics_admin_alias_ajouter(text, text)', 'execute')
    and has_function_privilege('authenticated',
                               'public.profils_publics_admin_alias_retirer(text)', 'execute')
    and has_function_privilege('authenticated', 'public.profils_publics_admin_alias_lister()', 'execute')
    and not has_function_privilege('anon',
                                   'public.profils_publics_admin_alias_ajouter(text, text)', 'execute')
    and not has_function_privilege('anon', 'public.profils_publics_admin_alias_retirer(text)', 'execute')
    and not has_function_privilege('anon', 'public.profils_publics_admin_alias_lister()', 'execute'),
    false) as fonctions_admin_membres_connectes_seulement,
  coalesce(has_function_privilege('anon', 'public.profil_public_alias_resoudre(text)', 'execute')
    and has_function_privilege('authenticated', 'public.profil_public_alias_resoudre(text)', 'execute')
    and has_function_privilege('anon', 'public.profil_public_lire(text)', 'execute'), false)
    as resolution_memes_droits_que_lire,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.proconfig is not null
      and p.proname in ('profils_publics_alias_pris', 'profils_publics_alias_garde',
                        'profils_publics_admin_alias_ajouter', 'profils_publics_admin_alias_retirer',
                        'profils_publics_admin_alias_lister', 'profil_public_alias_resoudre')) = 6
    as six_fonctions_definer_search_path,
  coalesce((select pg_get_function_result(p.oid) = 'text'
              from pg_proc p where p.oid = to_regprocedure('public.profil_public_alias_resoudre(text)')),
           false) as resolution_ne_renvoie_que_du_texte,
  coalesce((select position('user_id' in p.prosrc) = 0
              from pg_proc p where p.oid = to_regprocedure('public.profil_public_alias_resoudre(text)')),
           false) as resolution_sans_user_id,
  coalesce((select position('is_admin()' in p.prosrc) > 0 and position('non_admin' in p.prosrc) > 0
              and position('>= 5' in p.prosrc) > 0
              from pg_proc p
             where p.oid = to_regprocedure('public.profils_publics_admin_alias_ajouter(text, text)')),
           false) as ajouter_admin_et_limite_5,
  exists (select 1 from pg_trigger t
           where t.tgrelid = to_regclass('public.profils_publics')
             and t.tgname = 'profils_publics_alias_garde_trg' and t.tgenabled = 'O'
             and (t.tgtype & 2) = 2 and (t.tgtype & 1) = 1) as declencheur_alias_actif,
  exists (select 1 from pg_trigger t
           where t.tgrelid = to_regclass('public.profils_publics')
             and t.tgname = 'profils_publics_garde_trg' and t.tgenabled = 'O')
    as declencheur_existant_intact,
  coalesce((select position('alias' in p.prosrc) = 0
              from pg_proc p where p.oid = to_regprocedure('public.profils_publics_garde()')), false)
    as fonction_garde_existante_non_modifiee,
  coalesce((select pg_get_function_result(p.oid) = 'text'
              and position('profils_publics_alias_pris' in p.prosrc) > 0
              from pg_proc p
             where p.oid = to_regprocedure('public.profil_public_adresse_disponible(text)')),
           false) as adresse_disponible_voit_les_alias,
  coalesce((select position('alias' in p.prosrc) = 0
              from pg_proc p where p.oid = to_regprocedure('public.profil_public_lire(text)')), false)
    as profil_public_lire_non_modifiee;

-- 2. Declencheurs de profils_publics (detail)
select t.tgname as declencheur, t.tgenabled as etat
  from pg_trigger t
 where t.tgrelid = to_regclass('public.profils_publics') and not t.tgisinternal
 order by t.tgname;
