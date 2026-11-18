-- =========================================================
-- MAHOUTO+ — Institut SAYÉ LOUIS : VÉRIFICATION de institut-places.sql (lecture seule : AUCUNE écriture)
--
-- À exécuter à la main APRÈS institut-places.sql, requête par requête (sélectionnez une requête, puis « Run »).
-- Chaque requête indique son résultat attendu en commentaire.
-- =========================================================

-- 1. Les 4 nouvelles tables existent avec la RLS activée (attendu : 4 lignes, rls_activee = true)
select c.relname as table_institut, c.relrowsecurity as rls_activee
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('institut_formations', 'institut_dons', 'institut_places', 'institut_tentatives')
 order by c.relname;

-- 2. Règles d'accès (RLS) : commande, rôles, expressions
select tablename, policyname, cmd, roles, qual as condition_using, with_check as condition_with_check
  from pg_policies
 where schemaname = 'public' and tablename in ('institut_formations', 'institut_dons', 'institut_places', 'institut_tentatives')
 order by tablename, policyname;
-- Attendu : institut_formations : lecture publique des actives + admins ; institut_dons : admins seuls ;
-- institut_places : 3 règles de LECTURE (admin, parrain, bénéficiaire), aucune d'écriture ;
-- institut_tentatives : AUCUNE règle (aucun accès direct).

-- 3. Droits de table pour anon et authenticated (attendu : voir la colonne « attendu »)
select 'anon lit institut_formations (actives, voulu)' as controle, has_table_privilege('anon', 'public.institut_formations', 'select') as resultat, true as attendu
union all select 'anon lit institut_dons', has_table_privilege('anon', 'public.institut_dons', 'select'), false
union all select 'anon lit institut_places', has_table_privilege('anon', 'public.institut_places', 'select'), false
union all select 'anon lit institut_tentatives', has_table_privilege('anon', 'public.institut_tentatives', 'select'), false
union all select 'authenticated écrit institut_places', has_table_privilege('authenticated', 'public.institut_places', 'insert')
                                                       or has_table_privilege('authenticated', 'public.institut_places', 'update')
                                                       or has_table_privilege('authenticated', 'public.institut_places', 'delete'), false
union all select 'authenticated lit institut_tentatives', has_table_privilege('authenticated', 'public.institut_tentatives', 'select'), false
union all select 'authenticated écrit institut_tentatives', has_table_privilege('authenticated', 'public.institut_tentatives', 'insert'), false;

-- 4. Fonctions : search_path fixé, security definer seulement quand nécessaire (attendu : définer = attribuer, réclamer, stats)
select p.proname, p.prosecdef as security_definer, p.proconfig, pg_get_function_identity_arguments(p.oid) as arguments
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('institut_attribuer_place', 'institut_reclamer_place', 'institut_stats', 'institut_code_genere', 'institut_dons_garde', 'institut_formations_maj')
 order by p.proname;

-- 5. Qui peut exécuter quoi (attendu : voir la colonne « attendu »)
select 'attribuer : authenticated' as controle, has_function_privilege('authenticated', 'public.institut_attribuer_place(uuid, text, text, uuid)', 'execute') as resultat, true as attendu
union all select 'attribuer : anon', has_function_privilege('anon', 'public.institut_attribuer_place(uuid, text, text, uuid)', 'execute'), false
union all select 'réclamer : authenticated', has_function_privilege('authenticated', 'public.institut_reclamer_place(text)', 'execute'), true
union all select 'réclamer : anon', has_function_privilege('anon', 'public.institut_reclamer_place(text)', 'execute'), false
union all select 'stats : anon (compteurs publics)', has_function_privilege('anon', 'public.institut_stats()', 'execute'), true
union all select 'code_genere : authenticated (interne)', has_function_privilege('authenticated', 'public.institut_code_genere()', 'execute'), false
union all select 'code_genere : anon (interne)', has_function_privilege('anon', 'public.institut_code_genere()', 'execute'), false;

-- 6. institut_stats() ne renvoie que deux nombres (attendu : TABLE(places_financees integer, eleves_formes integer))
select pg_get_function_result('public.institut_stats()'::regprocedure) as resultat_de_institut_stats;

-- 7. Contraintes de institut_places (attendu : source, don, réclamée, code au format 8 caractères sans ambiguïté, uniques)
select conname, pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = 'public.institut_places'::regclass order by conname;

-- 8. Compteurs (lecture seule ; peuvent être à zéro tant qu'aucune place n'est attribuée)
select (select count(*) from public.institut_formations where actif) as formations_proposees,
       (select count(*) from public.institut_dons) as dons,
       (select count(*) from public.institut_places) as places,
       (select count(*) from public.institut_places where reclamee_le is not null) as places_reclamees;

-- 9. Les tables existantes n'ont pas changé de définition
-- 9a. Aucun objet de la PR 3 ne leur est rattaché (attendu : 0 ligne)
select 'règle RLS' as type, tablename as table_touchee, policyname as nom from pg_policies
 where schemaname = 'public' and tablename in ('formations', 'purchases', 'messages', 'rooms', 'profiles') and policyname ilike '%institut%'
union all
select 'déclencheur', c.relname, t.tgname
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('formations', 'purchases', 'messages', 'rooms', 'profiles') and not t.tgisinternal and t.tgname ilike '%institut%'
union all
select 'colonne', c.relname, a.attname
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('formations', 'purchases', 'messages', 'rooms', 'profiles')
   and a.attnum > 0 and not a.attisdropped and a.attname ilike '%institut%';

-- 9b. Empreinte (md5) de la définition de chaque table (colonnes, valeurs par défaut, règles, déclencheurs, contraintes,
-- index, RLS) : lancez cette requête AVANT puis APRÈS institut-places.sql (ou comparez à une exécution antérieure) :
-- les 8 empreintes doivent être IDENTIQUES (formations, purchases, messages, rooms, profiles, et les tables des PR 1 et 2).
select c.relname as table_surveillee,
       md5(
         coalesce((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), ''), ',' order by a.attnum)
                     from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                    where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '')
         || '|' ||
         coalesce((select string_agg(p.policyname || ':' || p.cmd || ':' || coalesce(p.qual, '') || ':' || coalesce(p.with_check, ''), ',' order by p.policyname)
                     from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname), '')
         || '|' ||
         coalesce((select string_agg(t.tgname, ',' order by t.tgname) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal), '')
         || '|' ||
         coalesce((select string_agg(k.conname || ':' || pg_get_constraintdef(k.oid), ',' order by k.conname) from pg_constraint k where k.conrelid = c.oid), '')
         || '|' ||
         coalesce((select string_agg(i.indexdef, ',' order by i.indexname) from pg_indexes i where i.schemaname = 'public' and i.tablename = c.relname), '')
         || '|' || c.relrowsecurity::text
       ) as empreinte
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('formations', 'purchases', 'messages', 'rooms', 'profiles', 'institut_demandes', 'institut_contenus', 'institut_petits_fils')
 order by c.relname;
