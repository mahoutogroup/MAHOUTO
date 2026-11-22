-- =========================================================
-- MAHOUTO+ - Institut SAYÉ LOUIS : VERIFICATION de institut-regles.sql (lecture seule : AUCUNE ecriture)
--
-- A executer a la main APRES institut-regles.sql, requete par requete (selectionnez une requete, puis Run).
-- Chaque requete indique son resultat attendu en commentaire.
-- =========================================================

-- 1. Colonnes (attendu : 2 lignes ; situation text not null, parrain_majeur boolean not null defaut false)
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'institut_demandes' and column_name in ('situation', 'parrain_majeur')
 order by column_name;

-- 2. Contraintes (attendu : age entre 14 et 25 ; situation pere, mere, deux_parents ; age >= 18 ou parrain_majeur ; convalidated = true)
select conname, convalidated, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conrelid = 'public.institut_demandes'::regclass
   and conname in ('institut_demandes_age_check', 'institut_demandes_situation_check', 'institut_demandes_parrain_majeur_check', 'institut_demandes_lui_meme_majeur_check')
 order by conname;

-- 3. Droit d insertion par colonne (attendu : situation et parrain_majeur = true ; traite_le, traite_par, raison_refus = false)
select c as colonne, has_column_privilege('authenticated', 'public.institut_demandes', c, 'insert') as insertion_autorisee
  from unnest(array['situation', 'parrain_majeur', 'age', 'traite_le', 'traite_par', 'raison_refus']) as c;

-- 4. Aucune mise a jour directe des deux colonnes (attendu : 2 lignes, false)
select c as colonne, has_column_privilege('authenticated', 'public.institut_demandes', c, 'update') as mise_a_jour_autorisee
  from unnest(array['situation', 'parrain_majeur']) as c;

-- 5. Fonction de garde : search_path fixe, et figee des deux colonnes (attendu : 1 ligne, les trois colonnes = true)
select p.proname,
       p.proconfig is not null as search_path_fixe,
       position('new.situation is distinct from old.situation' in p.prosrc) > 0 as situation_figee,
       position('new.parrain_majeur is distinct from old.parrain_majeur' in p.prosrc) > 0 as majeur_fige
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'institut_demandes_garde';

-- 6. Declencheur (attendu : 1 ligne, actif)
select tgname, tgenabled from pg_trigger where tgrelid = 'public.institut_demandes'::regclass and tgname = 'institut_demandes_garde_trg';

-- 7. Repartition (lecture seule) : peut etre vide
select situation, count(*) as demandes, count(*) filter (where age < 18) as mineurs, count(*) filter (where age < 18 and parrain_majeur) as mineurs_avec_declaration
  from public.institut_demandes group by situation order by situation;

-- 8. Lignes anciennes hors regle (attendu : 0 ligne ; sinon a corriger a la main)
select id, age, parrain_majeur, situation from public.institut_demandes where age not between 14 and 25 or (age < 18 and not parrain_majeur);
