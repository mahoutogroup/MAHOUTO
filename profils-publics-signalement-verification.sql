-- =========================================================
-- MAHOUTO+ - Profil public : VERIFICATION de profils-publics-signalement.sql
-- Lecture seule : AUCUNE ecriture.
--
-- A executer a la main APRES profils-publics-signalement.sql.
-- La REQUETE 1 donne le verdict en UNE SEULE LIGNE : tout doit etre true.
-- Les requetes suivantes sont des details.
-- =========================================================

-- 1. Verdict en une ligne (attendu : toutes les colonnes true)
select
  to_regclass('public.profils_publics_signalements') is not null as table_ok,
  (select c.relrowsecurity from pg_class c
    where c.oid = 'public.profils_publics_signalements'::regclass) as rls_ok,
  not has_table_privilege('anon', 'public.profils_publics_signalements',
    'select, insert, update, delete') as anon_aucun_droit,
  not has_table_privilege('authenticated', 'public.profils_publics_signalements',
    'select, insert, update, delete') as membres_aucun_droit,
  not exists (select 1 from pg_policies
    where tablename = 'profils_publics_signalements') as aucune_regle_directe,
  (has_function_privilege('authenticated', 'public.profil_public_signaler(text, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.profil_public_signaler(text, text, text)', 'execute')
  ) as signaler_membres_seulement,
  (has_function_privilege('authenticated',
      'public.profils_publics_signalements_admin_lister()', 'execute')
    and not has_function_privilege('anon',
      'public.profils_publics_signalements_admin_lister()', 'execute')
  ) as lister_sans_anon,
  not has_function_privilege('authenticated',
    'public.profils_publics_adresse_valide(text)', 'execute') as interne_non_exposee,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.proconfig is not null
      and p.proname in ('profil_public_signaler',
        'profils_publics_signalements_admin_lister',
        'profils_publics_signalements_admin_detail',
        'profils_publics_signalements_admin_traiter')) = 4 as quatre_fonctions_ok,
  (select count(*) from pg_constraint
    where conrelid = 'public.profils_publics_signalements'::regclass
      and conname in ('pps_motif_check', 'pps_detail_check',
        'pps_traite_check', 'pps_unique_par_membre')) = 4 as contraintes_ok,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'profils_publics_signalements'
      and column_name in ('page_id', 'signaleur_id', 'motif', 'detail',
        'adresse_vue', 'nom_vu', 'cree_le', 'traite', 'traite_le')) = 9 as colonnes_ok;

-- 2. Fonctions (attendu : 5 lignes ; definer et search_path fixe pour les 4 dernieres)
select p.proname, p.prosecdef as security_definer, p.proconfig is not null as search_path_fixe
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('profils_publics_adresse_valide', 'profil_public_signaler',
     'profils_publics_signalements_admin_lister', 'profils_publics_signalements_admin_detail',
     'profils_publics_signalements_admin_traiter')
 order by p.proname;

-- 3. Contraintes (attendu : motif, detail, traite, unicite par membre et par page, cles)
select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conrelid = 'public.profils_publics_signalements'::regclass
 order by conname;

-- 4. Compteurs (lecture seule ; zero tant qu aucun signalement n a eu lieu)
select count(*) as signalements, count(*) filter (where not traite) as non_traites,
       count(distinct page_id) as pages_signalees
  from public.profils_publics_signalements;
