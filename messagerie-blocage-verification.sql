-- =========================================================
-- MAHOUTO+ - Messagerie privee : VERIFICATION de messagerie-blocage.sql
-- Lecture seule : AUCUNE ecriture.
--
-- A executer a la main APRES messagerie-blocage.sql.
-- La REQUETE 1 donne le verdict en UNE SEULE LIGNE : toutes les colonnes
-- doivent valoir true. La requete 2 est un detail.
-- =========================================================

-- 1. Verdict en une ligne (attendu : toutes les colonnes true)
select
  coalesce((select c.relrowsecurity from pg_class c
             where c.oid = to_regclass('public.dm_blocages')), false) as table_avec_rls,
  exists (select 1 from pg_constraint k
           where k.conrelid = to_regclass('public.dm_blocages') and k.contype = 'p'
             and k.conkey is not null and cardinality(k.conkey) = 2) as cle_primaire_double,
  exists (select 1 from pg_constraint k
           where k.conrelid = to_regclass('public.dm_blocages') and k.contype = 'c'
             and k.conname = 'dm_blocages_pas_soi_meme') as refus_de_soi_meme,
  (select count(*) from pg_constraint k
    where k.conrelid = to_regclass('public.dm_blocages') and k.contype = 'f'
      and k.confdeltype = 'c' and k.confrelid = to_regclass('auth.users')) = 2
    as deux_cles_etrangeres_cascade,
  (select count(*) from pg_policies q
    where q.schemaname = 'public' and q.tablename = 'dm_blocages'
      and q.cmd = 'SELECT' and position('auth.uid()' in q.qual) > 0) = 1
    and (select count(*) from pg_policies q
          where q.schemaname = 'public' and q.tablename = 'dm_blocages') = 1
    as une_seule_regle_ses_lignes,
  has_column_privilege('authenticated', 'public.dm_blocages', 'bloque_id', 'select')
    and has_column_privilege('authenticated', 'public.dm_blocages', 'cree_le', 'select')
    and not has_column_privilege('authenticated', 'public.dm_blocages', 'bloqueur_id', 'select')
    as lecture_deux_colonnes_seulement,
  not has_table_privilege('authenticated', 'public.dm_blocages', 'insert, update, delete')
    and not has_table_privilege('anon', 'public.dm_blocages', 'select, insert, update, delete')
    as aucune_ecriture_directe,
  coalesce(not has_function_privilege('anon', 'public.dm_bloque_entre(uuid, uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.dm_bloque_entre(uuid, uuid)', 'execute'),
    false) as dm_bloque_entre_interne,
  coalesce(has_function_privilege('authenticated', 'public.dm_bloquer(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.dm_bloquer(uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.dm_debloquer(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.dm_debloquer(uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.dm_mes_blocages()', 'execute')
    and not has_function_privilege('anon', 'public.dm_mes_blocages()', 'execute'), false)
    as fonctions_membres_seulement,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.proconfig is not null
      and p.proname in ('dm_bloque_entre', 'dm_bloquer', 'dm_debloquer', 'dm_mes_blocages',
                        'dm_messages_controle_blocage', 'profil_public_ecrire')) = 6
    as six_fonctions_definer_search_path,
  coalesce((select pg_get_function_result(p.oid) =
             'TABLE(membre_id uuid, nom text, cree_le timestamp with time zone)'
              from pg_proc p where p.oid = to_regprocedure('public.dm_mes_blocages()')), false)
    as liste_sans_identite_du_bloqueur,
  exists (select 1 from pg_trigger t
           where t.tgrelid = to_regclass('public.dm_messages')
             and t.tgname = 'dm_messages_blocage' and t.tgenabled = 'O'
             and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4 and (t.tgtype & 1) = 1)
    as declencheur_actif_avant_insert,
  coalesce(not has_function_privilege('anon', 'public.dm_messages_controle_blocage()', 'execute')
    and not has_function_privilege('authenticated',
                                   'public.dm_messages_controle_blocage()', 'execute'), false)
    as fonction_declencheur_interne,
  coalesce((select position('auth.uid() is null' in p.prosrc) > 0
              and position('MB001' in p.prosrc) > 0
              and position('bloque' in lower(p.prosrc)) > 0
              from pg_proc p
             where p.oid = to_regprocedure('public.dm_messages_controle_blocage()')), false)
    as declencheur_neutre_et_ignore_sans_session,
  coalesce((select position('dm_bloque_entre' in p.prosrc) > 0
              and position('''desactive''' in p.prosrc) > 0
              and position('''limite''' in p.prosrc) > 0
              and position('''propre_page''' in p.prosrc) > 0
              and position('''ferme''' in p.prosrc) > 0
              and position('''introuvable''' in p.prosrc) > 0
              and position('''invalide''' in p.prosrc) > 0
              and position('''non_connecte''' in p.prosrc) > 0
              from pg_proc p
             where p.oid = to_regprocedure('public.profil_public_ecrire(text)')), false)
    as ecrire_garde_ses_codes_et_ajoute_le_blocage,
  not exists (select 1 from pg_policies q
               where q.schemaname = 'public'
                 and q.tablename in ('dm_messages', 'dm_conversations')
                 and (position('dm_blocages' in q.qual) > 0
                      or position('dm_blocages' in q.with_check) > 0))
    as politiques_dm_intactes;

-- 2. Declencheurs de dm_messages (detail)
select t.tgname as declencheur, t.tgenabled as etat
  from pg_trigger t
 where t.tgrelid = to_regclass('public.dm_messages') and not t.tgisinternal
 order by t.tgname;
