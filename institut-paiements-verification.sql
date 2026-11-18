-- =========================================================
-- MAHOUTO+ — Institut SAYÉ LOUIS : VÉRIFICATION de institut-paiements.sql (lecture seule : AUCUNE écriture)
--
-- À exécuter à la main APRÈS institut-paiements.sql, requête par requête (sélectionnez une requête, puis « Run »).
-- Chaque requête indique son résultat attendu en commentaire.
-- =========================================================

-- 1. La table existe avec la RLS activée (attendu : 1 ligne, rls_activee = true)
select c.relname as table_institut, c.relrowsecurity as rls_activee
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'institut_paiements';

-- 2. Règles d'accès : lecture seule (attendu : 2 règles « select » : le payeur, l'admin ; aucune d'écriture)
select policyname, cmd, roles, qual as condition_using
  from pg_policies where schemaname = 'public' and tablename = 'institut_paiements' order by policyname;

-- 3. Droits (attendu : voir la colonne « attendu »)
select 'anon lit institut_paiements' as controle, has_table_privilege('anon', 'public.institut_paiements', 'select') as resultat, false as attendu
union all select 'authenticated lit institut_paiements (RLS : le sien)', has_table_privilege('authenticated', 'public.institut_paiements', 'select'), true
union all select 'authenticated écrit institut_paiements', has_table_privilege('authenticated', 'public.institut_paiements', 'insert')
                                                         or has_table_privilege('authenticated', 'public.institut_paiements', 'update')
                                                         or has_table_privilege('authenticated', 'public.institut_paiements', 'delete'), false
union all select 'anon écrit institut_paiements', has_table_privilege('anon', 'public.institut_paiements', 'insert')
                                                or has_table_privilege('anon', 'public.institut_paiements', 'update')
                                                or has_table_privilege('anon', 'public.institut_paiements', 'delete'), false;

-- 4. Fonctions : search_path fixé, security definer, qui peut les exécuter (attendu : voir « attendu »)
select p.proname, p.prosecdef as security_definer, p.proconfig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('institut_confirmer_paiement', 'institut_echouer_paiement', 'institut_paiement_place', 'institut_paiement_acces')
 order by p.proname;

select 'confirmer : service_role' as controle, has_function_privilege('service_role', 'public.institut_confirmer_paiement(text, integer)', 'execute') as resultat, true as attendu
union all select 'confirmer : authenticated', has_function_privilege('authenticated', 'public.institut_confirmer_paiement(text, integer)', 'execute'), false
union all select 'confirmer : anon', has_function_privilege('anon', 'public.institut_confirmer_paiement(text, integer)', 'execute'), false
union all select 'échouer : authenticated', has_function_privilege('authenticated', 'public.institut_echouer_paiement(text)', 'execute'), false
union all select 'échouer : anon', has_function_privilege('anon', 'public.institut_echouer_paiement(text)', 'execute'), false
union all select 'interne place : authenticated', has_function_privilege('authenticated', 'public.institut_paiement_place(uuid)', 'execute'), false
union all select 'interne place : anon', has_function_privilege('anon', 'public.institut_paiement_place(uuid)', 'execute'), false
union all select 'interne accès : authenticated', has_function_privilege('authenticated', 'public.institut_paiement_acces(uuid)', 'execute'), false
union all select 'interne accès : anon', has_function_privilege('anon', 'public.institut_paiement_acces(uuid)', 'execute'), false;

-- 5. Contraintes de institut_places (attendu : source dans don / offerte / payee ; don_id nul pour offerte et payee)
select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint where conrelid = 'public.institut_places'::regclass and conname in ('institut_places_source_check', 'institut_places_don_check')
 order by conname;

-- 6. Contraintes de institut_paiements
select conname, pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = 'public.institut_paiements'::regclass order by conname;

-- 7. Compteurs (lecture seule ; peuvent être à zéro tant qu'aucun paiement n'a eu lieu)
select count(*) as paiements, count(*) filter (where statut = 'paye') as payes, count(*) filter (where statut = 'en_attente') as en_attente,
       count(*) filter (where statut = 'echoue') as echoues, count(*) filter (where note is not null) as avec_anomalie
  from public.institut_paiements;

-- 8. Les tables existantes n'ont pas changé de définition (hors institut_places, modifiée volontairement au BLOC 2)
-- 8a. Aucun objet de la PR 4 ne leur est rattaché (attendu : 0 ligne)
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

-- 8b. Empreinte (md5) de la définition de chaque table : lancez cette requête AVANT puis APRÈS institut-paiements.sql :
-- les 9 empreintes doivent être IDENTIQUES (formations, purchases, messages, rooms, profiles, institut_demandes,
-- institut_contenus, institut_petits_fils, institut_formations, institut_dons) SAUF institut_places (contraintes
-- élargies : attendu) — qui n'est donc pas dans cette liste.
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
   and c.relname in ('formations', 'purchases', 'messages', 'rooms', 'profiles', 'institut_demandes', 'institut_contenus', 'institut_petits_fils', 'institut_formations', 'institut_dons')
 order by c.relname;
