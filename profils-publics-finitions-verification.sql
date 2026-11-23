-- =========================================================
-- MAHOUTO+ - Profil public : VERIFICATION de profils-publics-finitions.sql
-- Lecture seule : AUCUNE ecriture.
--
-- A executer a la main APRES profils-publics-finitions.sql.
-- La REQUETE 1 donne le verdict en UNE SEULE LIGNE : toutes les colonnes
-- doivent valoir true. La requete 2 est un detail.
-- =========================================================

-- 1. Verdict en une ligne (attendu : toutes les colonnes true)
select
  exists (select 1 from pg_trigger t
           where t.tgrelid = 'public.profils_publics_reglages'::regclass
             and t.tgname = 'profils_publics_reglages_maj_trg'
             and t.tgenabled = 'O') as declencheur_actif,
  coalesce((select (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16
                   and (t.tgtype & 4) = 0 and (t.tgtype & 8) = 0
              from pg_trigger t
             where t.tgrelid = 'public.profils_publics_reglages'::regclass
               and t.tgname = 'profils_publics_reglages_maj_trg'),
           false) as avant_update_par_ligne,
  coalesce((select not p.prosecdef and p.proconfig is not null
              from pg_proc p
             where p.oid = to_regprocedure('public.profils_publics_reglages_maj()')),
           false) as fonction_invoker_search_path,
  to_regprocedure('public.profil_public_visites_mien(integer)') is not null as visites_presente,
  coalesce((select p.prosecdef and p.proconfig is not null
                   and position('partage' in p.prosrc) > 0
              from pg_proc p
             where p.oid = to_regprocedure('public.profil_public_visites_mien(integer)')),
           false) as visites_recree_avec_partage,
  coalesce(has_function_privilege('authenticated',
    'public.profil_public_visites_mien(integer)', 'execute'), false) as membres_peuvent,
  coalesce(not has_function_privilege('anon',
    'public.profil_public_visites_mien(integer)', 'execute'), false) as anon_exclu,
  coalesce((select pg_get_function_result(p.oid) =
                   'TABLE(jour date, visites integer, qr integer, lien integer, autre integer)'
              from pg_proc p
             where p.oid = to_regprocedure('public.profil_public_visites_mien(integer)')),
           false) as memes_colonnes;

-- 2. Declencheur (attendu : 1 ligne)
select t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) as definition
  from pg_trigger t
 where t.tgrelid = 'public.profils_publics_reglages'::regclass and not t.tgisinternal;
