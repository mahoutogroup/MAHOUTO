-- =========================================================
-- MAHOUTO+ - Profil public : VERIFICATION de profils-publics.sql (lecture seule : AUCUNE ecriture)
--
-- A executer a la main APRES profils-publics.sql, requete par requete (selectionnez une requete, puis Run).
-- Chaque requete indique son resultat attendu en commentaire.
-- =========================================================

-- 1. Les deux tables existent, RLS activee (attendu : 2 lignes, rls_activee = true)
select c.relname as table_profil, c.relrowsecurity as rls_activee
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('profils_publics', 'profils_publics_reglages') order by c.relname;

-- 2. Interrupteur (attendu : 1 ligne, ouvert = non tant que vous ne l avez pas ouvert)
select cle, valeur, public.profils_publics_ouvert() as ouvert from public.profils_publics_reglages;

-- 3. Droits de lecture pour anon (attendu : false pour TOUTES les colonnes : le public ne lit jamais la table, il passe par profil_public_lire)
select c as colonne, has_column_privilege('anon', 'public.profils_publics', c, 'select') as lisible_par_anon
  from unnest(array['id', 'adresse', 'nom_affiche', 'avatar_url', 'metier', 'presentation', 'localisation', 'contact_type', 'contact_valeur', 'publie',
                    'user_id', 'majeur_declare', 'suspendu', 'publie_le', 'cree_le', 'modifie_le']) as c;

-- 4. Colonnes pour authenticated (attendu : lisible = true seulement pour id ; suspendu, user_id, publie_le jamais modifiables ; user_id, majeur_declare, suspendu jamais lisibles)
select c as colonne, has_column_privilege('authenticated', 'public.profils_publics', c, 'select') as lisible,
       has_column_privilege('authenticated', 'public.profils_publics', c, 'insert') as insertion,
       has_column_privilege('authenticated', 'public.profils_publics', c, 'update') as mise_a_jour
  from unnest(array['id', 'adresse', 'nom_affiche', 'publie', 'majeur_declare', 'user_id', 'suspendu', 'publie_le']) as c;

-- 5. Aucun droit de suppression (attendu : false, false)
select has_table_privilege('anon', 'public.profils_publics', 'delete') as anon_supprime,
       has_table_privilege('authenticated', 'public.profils_publics', 'delete') as authenticated_supprime;

-- 6. Regles RLS (attendu : 5 regles, AUCUNE lecture publique : proprietaire et admin pour la lecture ; proprietaire et admin pour la mise a jour ; proprietaire pour l insertion ; aucune regle pour anon)
select policyname, cmd, roles from pg_policies where schemaname = 'public' and tablename = 'profils_publics' order by policyname;

-- 7. Contraintes (attendu : adresse, nom, avatar, textes, contact, majeur, publie_le + cles unique et etrangere)
select conname, pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = 'public.profils_publics'::regclass order by conname;

-- 8. Fonctions : security definer et search_path fixe (attendu : 11 lignes, search_path_fixe = true)
select p.proname, p.prosecdef as security_definer, p.proconfig is not null as search_path_fixe
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('profils_publics_ouvert', 'profils_publics_adresse_reservee', 'profils_publics_garde', 'profil_public_mien',
       'profil_public_adresse_disponible', 'profil_public_statut', 'profil_public_lire', 'profils_publics_admin_lister', 'profils_publics_admin_lire', 'profils_publics_admin_suspendre', 'profils_publics_admin_adresse')
 order by p.proname;

-- 9. Qui peut executer quoi (attendu : voir la colonne attendu)
select 'anon : profil_public_mien' as controle, has_function_privilege('anon', 'public.profil_public_mien()', 'execute') as resultat, false as attendu
union all select 'authenticated : profil_public_mien', has_function_privilege('authenticated', 'public.profil_public_mien()', 'execute'), true
union all select 'anon : adresse_disponible', has_function_privilege('anon', 'public.profil_public_adresse_disponible(text)', 'execute'), false
union all select 'anon : statut', has_function_privilege('anon', 'public.profil_public_statut(text)', 'execute'), true
union all select 'anon : lire une page par adresse', has_function_privilege('anon', 'public.profil_public_lire(text)', 'execute'), true
union all select 'authenticated : lire une page par adresse', has_function_privilege('authenticated', 'public.profil_public_lire(text)', 'execute'), true
union all select 'anon : admin_lire', has_function_privilege('anon', 'public.profils_publics_admin_lire(text)', 'execute'), false
union all select 'anon : admin_lister', has_function_privilege('anon', 'public.profils_publics_admin_lister()', 'execute'), false
union all select 'anon : ouvert', has_function_privilege('anon', 'public.profils_publics_ouvert()', 'execute'), true;

-- 10. Declencheur de garde (attendu : 1 ligne, actif)
select tgname, tgenabled from pg_trigger where tgrelid = 'public.profils_publics'::regclass and tgname = 'profils_publics_garde_trg';

-- 11. Compteurs (lecture seule ; peuvent etre a zero)
select count(*) as pages, count(*) filter (where publie) as publiees, count(*) filter (where suspendu) as suspendues from public.profils_publics;

-- 11b. Aucune regle de lecture publique (attendu : 0 ligne)
select policyname from pg_policies where schemaname = 'public' and tablename = 'profils_publics' and (policyname = 'profils_publics_lecture_publique' or 'anon' = any (roles));

-- 12. La table profiles n a pas ete modifiee (attendu : 0 ligne)
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'profiles' and column_name in ('adresse', 'nom_affiche', 'suspendu', 'majeur_declare');
