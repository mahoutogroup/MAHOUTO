-- ============================================================
-- MAHOUTO+ — 004 : pseudos uniques
-- ============================================================
--
-- Les pseudos ne sont pas uniques aujourd'hui (3 paires de doublons
-- constatées) : deux personnes peuvent s'appeler pareil, y compris à
-- l'accent, à la casse ou à un espace près.
--
-- Ce script ajoute un INDEX UNIQUE sur le pseudo normalisé :
--   lower(translate(regexp_replace(trim(username), '\s+', ' ', 'g'), 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŸ', 'aaaaaaceeeeiiiinooooouuuuyyaaaaaaceeeeiiiinooooouuuuyy'))
-- c'est-à-dire : espaces de début/fin retirés, espaces multiples réduits à un
-- seul, accents retirés (minuscules et majuscules), casse ignorée. Les pseudos
-- vides sont ignorés (index partiel : where trim(username) <> '').
--
-- Il COMMENCE par une vérification : s'il reste le moindre doublon, il
-- s'arrête proprement (rien n'est modifié) et dit combien il en reste.
--
-- ORDRE : ce script vient APRÈS le renommage manuel des doublons.
--   1. Lancer la REQUÊTE 3 de 000_diagnostic_lecture_seule.sql : elle liste
--      les groupes de doublons (avec identifiant, pseudo, rôle, date de
--      création et e-mail de chaque compte).
--   2. Faire renommer chaque doublon par la personne concernée, ou le faire
--      soi-même dans le SQL Editor (le déclencheur de la migration 002 laisse
--      passer le SQL Editor), pour un compte à la fois :
--        update public.profiles set username = 'Nouveau pseudo' where id = '<uuid>';
--   3. Relancer la REQUÊTE 3 jusqu'à « nb_groupes_de_doublons: 0 », puis
--      exécuter ce script.
--
-- Aucune donnée n'est modifiée par ce script (création d'un index seulement).
-- Un pseudo déjà pris est ensuite refusé par la base (erreur 23505 sur
-- profiles_username_unique_idx) ; les pages affichent « Ce pseudo est déjà pris ».
--
-- ⚠️ À EXÉCUTER MANUELLEMENT (SQL Editor Supabase), APRÈS le déploiement du
-- code de la PR (qui gère ce refus) et APRÈS 001 et 002.
-- Retour arrière : migrations/rollback/004_pseudos_uniques.sql
-- ------------------------------------------------------------

begin;

do $$
declare
  nb integer;
begin
  select count(*) into nb
  from (
    select 1
    from public.profiles
    where trim(username) <> ''
    group by lower(translate(regexp_replace(trim(username), '\s+', ' ', 'g'), 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŸ', 'aaaaaaceeeeiiiinooooouuuuyyaaaaaaceeeeiiiinooooouuuuyy'))
    having count(*) > 1
  ) d;

  if nb > 0 then
    raise exception
      'Il reste % groupe(s) de pseudos en double. Rien n''a ete modifie. Lancez la requete 3 de 000_diagnostic_lecture_seule.sql, faites renommer les doublons, puis relancez ce script.',
      nb;
  end if;
end $$;

create unique index if not exists profiles_username_unique_idx
  on public.profiles ((lower(translate(regexp_replace(trim(username), '\s+', ' ', 'g'), 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŸ', 'aaaaaaceeeeiiiinooooouuuuyyaaaaaaceeeeiiiinooooouuuuyy'))))
  where trim(username) <> '';

commit;
