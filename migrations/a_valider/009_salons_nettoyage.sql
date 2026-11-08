-- ============================================================
-- MAHOUTO+ — 009 (à VALIDER par toi avant exécution) : nettoyage des salons
-- qui violent les formats de la migration 009
-- ============================================================
-- Ce script MODIFIE des données. Il ne supprime aucun salon ni aucun message :
-- il remplace seulement les valeurs invalides par des valeurs neutres :
--   color     invalide → '#22C55E' (valeur par défaut de la colonne)
--   emoji     invalide → '💬'      (valeur par défaut de la colonne)
--   photo_url invalide → NULL      (le salon retrouve son émoji)
-- Les noms et tous les autres champs ne sont pas touchés.
--
-- Mode d'emploi :
--   1. lancer d'abord migrations/a_valider/009_salons_violations_lecture_seule.sql
--      et relire la liste (ces valeurs sont peut-être une attaque : à garder
--      pour les traces si besoin, par exemple une capture) ;
--   2. lancer CE script tel quel : il affiche le nombre de lignes modifiées
--      puis s'ANNULE (rollback en dernière ligne) ;
--   3. si le résultat te convient, remplace la dernière ligne « rollback; »
--      par « commit; » et relance-le ;
--   4. relancer la migration 009 (les contraintes seront alors validées).
-- ------------------------------------------------------------

begin;

with maj as (
  update public.rooms r
     set color = case when r.color ~ '^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$' then r.color else '#22C55E' end,
         emoji = case when char_length(r.emoji) between 1 and 16 and r.emoji !~ '[<>"''&[:cntrl:]\u2028\u2029]' then r.emoji else '💬' end,
         photo_url = case when r.photo_url is null or (char_length(r.photo_url) <= 2048 and r.photo_url ~* '^https://[^[:space:]"''<>`\\]+$') then r.photo_url else null end
   where not (r.color ~ '^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$')
      or not (char_length(r.emoji) between 1 and 16 and r.emoji !~ '[<>"''&[:cntrl:]\u2028\u2029]')
      or not (r.photo_url is null or (char_length(r.photo_url) <= 2048 and r.photo_url ~* '^https://[^[:space:]"''<>`\\]+$'))
  returning r.id
)
select count(*) as salons_nettoyes from maj;

-- ⚠️ Annule tout par défaut. Remplace par « commit; » après relecture.
rollback;
