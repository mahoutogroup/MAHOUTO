-- =========================================================
-- MAHOUTO+ - Profil public : VERIFICATION de profils-publics-visiteurs.sql
-- Lecture seule : AUCUNE ecriture. A executer a la main APRES profils-publics-visiteurs.sql.
-- UNE seule requete, UNE seule ligne : toutes les colonnes doivent valoir true.
-- =========================================================

select
  to_regclass('public.profils_publics_visiteurs_reglages') is not null
    and to_regclass('public.profils_publics_passages') is not null as deux_tables_presentes,
  coalesce((select c.relrowsecurity from pg_class c
             where c.oid = to_regclass('public.profils_publics_visiteurs_reglages')), false)
    and coalesce((select c.relrowsecurity from pg_class c
                   where c.oid = to_regclass('public.profils_publics_passages')), false) as rls_activee,
  coalesce((select a.attname is not null and pg_get_expr(d.adbin, d.adrelid) = 'false'
              from pg_attribute a
              join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
             where a.attrelid = to_regclass('public.profils_publics_visiteurs_reglages')
               and a.attname = 'montrer_mon_nom' and a.attnotnull), false) as
                   reglage_desactive_par_defaut,
  (select count(*) from pg_policies q
    where q.schemaname = 'public' and q.tablename = 'profils_publics_passages') = 0
    as aucune_politique_sur_les_passages,
  (select count(*) from pg_policies q
    where q.schemaname = 'public' and q.tablename = 'profils_publics_visiteurs_reglages') = 1
    and exists (select 1 from pg_policies q
                 where q.schemaname = 'public' and q.tablename = 'profils_publics_visiteurs_reglages'
                   and q.cmd = 'SELECT' and position('auth.uid()' in q.qual) > 0)
    as une_seule_regle_sa_propre_ligne,
  coalesce(not has_table_privilege('anon', 'public.profils_publics_passages', 'select, insert,
      update, delete')
    and not has_table_privilege('authenticated', 'public.profils_publics_passages',
                                'select, insert, update, delete')
    and not has_table_privilege('anon', 'public.profils_publics_visiteurs_reglages',
                                'select, insert, update, delete')
    and not has_table_privilege('authenticated', 'public.profils_publics_visiteurs_reglages',
                                'insert, update, delete'), false) as
                                    aucun_droit_direct_sauf_lire_le_sien,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.proconfig is not null
      and p.proname in ('profil_public_visiteur_enregistrer', 'profil_public_visiteur_reglage_lire',
                        'profil_public_visiteur_reglage_ecrire', 'profil_public_visiteurs_lister',
                        'profil_public_visiteurs_purger')) = 5 as cinq_fonctions_definer_search_path,
  coalesce(has_function_privilege('authenticated',
      'public.profil_public_visiteur_enregistrer(text)', 'execute')
    and has_function_privilege('authenticated', 'public.profil_public_visiteur_reglage_lire()',
        'execute')
    and has_function_privilege('authenticated',
        'public.profil_public_visiteur_reglage_ecrire(boolean)', 'execute')
    and has_function_privilege('authenticated', 'public.profil_public_visiteurs_lister()', 'execute')
    and has_function_privilege('authenticated', 'public.profil_public_visiteurs_purger()',
        'execute'), false)
    as membres_connectes_peuvent_appeler,
  coalesce(not has_function_privilege('anon', 'public.profil_public_visiteur_enregistrer(text)',
      'execute')
    and not has_function_privilege('anon', 'public.profil_public_visiteur_reglage_lire()', 'execute')
    and not has_function_privilege('anon', 'public.profil_public_visiteur_reglage_ecrire(boolean)',
        'execute')
    and not has_function_privilege('anon', 'public.profil_public_visiteurs_lister()', 'execute')
    and not has_function_privilege('anon', 'public.profil_public_visiteurs_purger()', 'execute'), false)
    as anon_ne_peut_rien_appeler,
  coalesce((select pg_get_function_result(p.oid) =
             'TABLE(nom text, adresse text, nb_visites integer, dernier_jour date)'
              from pg_proc p where p.oid =
                  to_regprocedure('public.profil_public_visiteurs_lister()')), false)
    as liste_sans_identifiant_ni_heure,
  exists (select 1 from pg_constraint k
           where k.conrelid = to_regclass('public.profils_publics_passages') and k.contype = 'p'
             and k.conkey is not null and cardinality(k.conkey) = 2) as un_seul_passage_par_couple,
  exists (select 1 from pg_constraint k
           where k.conrelid = to_regclass('public.profils_publics_passages') and k.contype = 'c'
             and k.conname = 'pp_passages_pas_soi_meme') as refus_de_sa_propre_page;
