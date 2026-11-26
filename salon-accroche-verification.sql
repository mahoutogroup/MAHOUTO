-- =========================================================
-- MAHOUTO+ - VERIFICATION de salon-accroche.sql
-- Lecture seule : AUCUNE ecriture. A executer a la main APRES salon-accroche.sql.
-- UNE seule requete, UNE seule ligne : toutes les colonnes doivent valoir true.
-- =========================================================

select
  exists (select 1 from information_schema.columns c
           where c.table_schema = 'public' and c.table_name = 'rooms'
             and c.column_name = 'accroche' and c.data_type = 'text' and c.is_nullable = 'YES')
    as colonne_presente_texte_facultatif,
  exists (select 1 from pg_constraint k
           where k.conrelid = to_regclass('public.rooms') and k.contype = 'c'
             and k.conname = 'rooms_accroche_longueur_check'
             and position('120' in pg_get_constraintdef(k.oid)) > 0)
    as contrainte_longueur_120_presente,
  exists (select 1 from pg_constraint k
           where k.conrelid = to_regclass('public.rooms') and k.contype = 'c'
             and k.conname = 'rooms_accroche_une_ligne_check')
    as contrainte_une_ligne_presente,
  exists (select 1 from pg_policies q
           where q.schemaname = 'public' and q.tablename = 'rooms'
             and q.policyname = 'rooms_public_read' and q.cmd = 'SELECT' and q.qual = 'true')
    as lecture_publique_comme_le_nom_et_le_prix,
  (select count(*) from pg_policies q
    where q.schemaname = 'public' and q.tablename = 'rooms' and q.cmd = 'UPDATE') = 1
    and exists (select 1 from pg_policies q
                 where q.schemaname = 'public' and q.tablename = 'rooms' and q.cmd = 'UPDATE'
                   and q.policyname = 'rooms_update_own_or_admin'
                   and position('created_by' in q.qual) > 0 and position('is_admin' in q.qual) > 0)
    as ecriture_reservee_createur_ou_administrateur,
  not exists (select 1 from pg_policies q
               where q.schemaname = 'public' and q.tablename = 'rooms'
                 and q.cmd in ('INSERT', 'UPDATE', 'DELETE')
                 and position('auth.uid()' in coalesce(q.qual, '') || coalesce(q.with_check, '')) = 0
                 and position('is_admin' in coalesce(q.qual, '') || coalesce(q.with_check, '')) = 0)
    as aucune_ecriture_sans_controle_donc_rien_pour_anon;
