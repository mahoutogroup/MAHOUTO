-- =========================================================
-- MAHOUTO+ — BLOC FACULTATIF : garder en ligne les vitrines DÉJÀ PUBLIÉES
--
-- ► CE FICHIER EST SÉPARÉ ET FACULTATIF : vous l'exécutez ou non.
-- ► À exécuter À LA MAIN, APRÈS entreprises-abonnement.sql, de préférence tout de suite
--   (entre les deux exécutions, les vitrines publiées sont invisibles : expire_le vide et
--   offerte = false).
-- ► Effet : met offerte = true sur les vitrines publiées qui n'ont jamais été payées
--   (expire_le vide). Elles restent visibles gratuitement ; vous retirez la gratuité plus tard,
--   vitrine par vitrine, depuis admin/vitrines.html (« Retirer la gratuité »).
-- ► Ne touche QUE public.entreprises.offerte. Idempotent (relançable).
-- ► Retour : voir la requête de défaire en bas (à adapter à VOS vitrines).
-- =========================================================

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'entreprises' and column_name = 'offerte'
  ) then
    raise exception 'Colonne offerte introuvable : exécutez d''abord entreprises-abonnement.sql';
  end if;
end $$;

-- Combien de vitrines seront concernées (lecture seule) :
--   select count(*) from public.entreprises where published = true and offerte = false and expire_le is null;

update public.entreprises
   set offerte = true
 where published = true
   and offerte = false
   and expire_le is null;

-- Pour retirer la gratuité d'UNE vitrine (exemple, remplacez le slug) :
--   update public.entreprises set offerte = false where slug = 'mon-slug';
