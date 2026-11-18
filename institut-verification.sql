-- =========================================================
-- MAHOUTO+ — Institut SAYÉ LOUIS : VÉRIFICATION (lecture seule : AUCUNE écriture, rien n'est modifié)
--
-- À exécuter à la main APRÈS institut.sql, requête par requête (sélectionnez une requête, puis « Run »).
-- Chaque requête affiche son résultat attendu en commentaire.
-- =========================================================

-- 1. Les 3 tables existent (attendu : 3 lignes)
select c.relname as table_institut, c.relrowsecurity as rls_activee
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('institut_contenus', 'institut_demandes', 'institut_petits_fils')
 order by c.relname;
-- Attendu : rls_activee = true pour les 3 tables.

-- 2. Règles d'accès (RLS) des 3 tables : commande, rôles, expressions
select tablename, policyname, cmd, roles, qual as condition_using, with_check as condition_with_check
  from pg_policies
 where schemaname = 'public' and tablename in ('institut_contenus', 'institut_demandes', 'institut_petits_fils')
 order by tablename, policyname;
-- Attendu : lecture publique SEULEMENT sur institut_contenus ; toute écriture passe par is_admin() ;
-- institut_demandes : select (parrain_id = auth.uid() ou is_admin()), insert pour soi-même seulement.

-- 3. Aucun droit pour anon sur les demandes et les petits-fils ; écriture de institut_contenus interdite à anon
select 'anon lit institut_demandes' as controle, has_table_privilege('anon', 'public.institut_demandes', 'select') as resultat
union all select 'anon lit institut_petits_fils', has_table_privilege('anon', 'public.institut_petits_fils', 'select')
union all select 'anon écrit institut_contenus', has_table_privilege('anon', 'public.institut_contenus', 'insert')
                                              or has_table_privilege('anon', 'public.institut_contenus', 'update')
                                              or has_table_privilege('anon', 'public.institut_contenus', 'delete')
union all select 'anon lit institut_contenus (voulu : true)', has_table_privilege('anon', 'public.institut_contenus', 'select');
-- Attendu : false, false, false, puis true.

-- 4. Le parrain ne peut ni supprimer ni modifier le contenu d'une demande (droits de colonnes)
select 'authenticated supprime une demande' as controle, has_table_privilege('authenticated', 'public.institut_demandes', 'delete') as resultat
union all select 'authenticated modifie le prénom', has_column_privilege('authenticated', 'public.institut_demandes', 'prenom', 'update')
union all select 'authenticated modifie le statut (bornée par RLS : admin)', has_column_privilege('authenticated', 'public.institut_demandes', 'statut', 'update');
-- Attendu : false, false, true (la règle RLS réserve cette modification aux admins).

-- 5. Fonctions : search_path fixé (attendu : un search_path dans proconfig pour chaque fonction)
select p.proname, p.prosecdef as security_definer, p.proconfig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('institut_ouvert', 'institut_demandes_garde', 'institut_contenus_maj')
 order by p.proname;
-- Attendu : proconfig contient search_path=public, pg_temp ; security_definer = false.

-- 6. Textes de départ (attendu : 'ouvert' = non tant que vous n'avez pas ouvert l'Institut ; 'histoire' non vide)
select cle, left(valeur, 60) as debut, char_length(valeur) as longueur, maj_le from public.institut_contenus order by cle;

-- 7. Bucket privé (attendu : public = false ; limite 5242880 ; 4 types)
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'institut-justificatifs';

-- 8. Règles d'accès du bucket : seulement celles de l'Institut (attendu : 3 lignes : insert, select, delete)
select policyname, cmd, qual as condition_using, with_check as condition_with_check
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects' and policyname like 'institut_justificatifs%'
 order by policyname;

-- 9. public.purchases, public.messages, public.rooms (et profiles) n'ont pas été touchés
-- 9a. Aucun objet de l'Institut ne leur est rattaché (attendu : 0 ligne)
select 'colonne' as type, c.relname as table_touchee, a.attname as nom
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('purchases', 'messages', 'rooms', 'profiles')
   and a.attnum > 0 and not a.attisdropped and a.attname ilike '%institut%'
union all
select 'règle RLS', tablename, policyname from pg_policies
 where schemaname = 'public' and tablename in ('purchases', 'messages', 'rooms', 'profiles') and policyname ilike '%institut%'
union all
select 'déclencheur', c.relname, t.tgname
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('purchases', 'messages', 'rooms', 'profiles') and not t.tgisinternal and t.tgname ilike '%institut%';

-- 9b. Empreinte (md5) de la structure et des règles de chaque table : lancez cette requête AVANT puis APRÈS
-- institut.sql (ou comparez à une exécution antérieure) : les 4 empreintes doivent être IDENTIQUES.
select c.relname as table_surveillee,
       md5(
         coalesce((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' order by a.attnum)
                     from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '')
         || '|' ||
         coalesce((select string_agg(p.policyname || ':' || p.cmd || ':' || coalesce(p.qual, '') || ':' || coalesce(p.with_check, ''), ',' order by p.policyname)
                     from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname), '')
         || '|' ||
         coalesce((select string_agg(t.tgname, ',' order by t.tgname)
                     from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal), '')
         || '|' || c.relrowsecurity::text
       ) as empreinte
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('messages', 'profiles', 'purchases', 'rooms')
 order by c.relname;
