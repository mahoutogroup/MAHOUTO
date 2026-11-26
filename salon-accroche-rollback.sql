-- =========================================================
-- MAHOUTO+ - RETOUR ARRIERE de salon-accroche.sql
--
-- Defait exactement ce que salon-accroche.sql ajoute : les deux contraintes puis la colonne accroche.
-- Aucune politique, aucune fonction, aucun droit n etant modifies par salon-accroche.sql, rien d autre
-- n est touche. Chaque bloc se relance sans erreur.
-- Deployez d abord le code precedent (sans la PR) avant le bloc 2 : sans la colonne, le code de la PR
-- lit le salon sans l accroche et affiche le texte par defaut.
-- BLOC 1 : retire les deux contraintes (sans perte de donnees).
-- BLOC 2 : supprime la colonne (confirmation requise : les phrases ecrites sont PERDUES).
-- =========================================================


-- BLOC 1 - Retrait des deux contraintes (sans confirmation, sans perte de donnees)
alter table public.rooms drop constraint if exists rooms_accroche_une_ligne_check;

alter table public.rooms drop constraint if exists rooms_accroche_longueur_check;


-- BLOC 2 - Suppression de la colonne (confirmation requise : les phrases ecrites sont PERDUES)
do $$
declare
  confirmation constant text := 'NON';
  n_phrases integer := 0;
begin
  if exists (select 1 from information_schema.columns c
              where c.table_schema = 'public' and c.table_name = 'rooms'
                and c.column_name = 'accroche') then
    execute 'select count(*) from public.rooms where accroche is not null' into n_phrases;
  end if;
  raise warning 'ATTENTION : % phrases d accroche seront PERDUES.', n_phrases;
  if confirmation <> 'OUI' then
    raise exception 'Retour arriere NON confirme. Editez confirmation := OUI.';
  end if;
  alter table public.rooms drop column if exists accroche;
end $$;
