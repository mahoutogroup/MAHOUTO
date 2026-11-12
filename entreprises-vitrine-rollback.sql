-- =========================================================
-- MAHOUTO+ — Vitrine d'entreprise : RETOUR ARRIÈRE de entreprises-vitrine.sql
--
-- ⚠️⚠️ ATTENTION : CE FICHIER SUPPRIME LES TABLES public.entreprises,
--     public.entreprise_produits ET public.entreprise_photos, AVEC TOUTES LES
--     DONNÉES SAISIES (entreprises, produits, photos, légendes).
--     CETTE OPÉRATION EST IRRÉVERSIBLE. Faites d'abord une sauvegarde / un export si besoin.
--     (Les images elles-mêmes restent sur Cloudinary : seule leur référence en base disparaît.)
--
-- ► À exécuter À LA MAIN, après relecture. Par sécurité, il refuse de s'exécuter
--   tant que la ligne « confirmation » du §0 n'est pas passée de 'NON' à 'OUI'.
-- ► Ne supprime QUE ce que entreprises-vitrine.sql a créé : 3 tables (avec leurs
--   policies, contraintes, index et triggers) et 3 fonctions. Il ne touche JAMAIS
--   public.is_admin(), public.serigraphie_https_only(text[]) ni aucune autre table.
-- ► Relançable sans erreur (drop ... if exists).
-- =========================================================


-- =========================================================
-- 0. CONFIRMATION ET AVERTISSEMENT
-- =========================================================
do $$
declare
  confirmation constant text := 'NON';   -- ← remplacez par 'OUI' pour autoriser la suppression
  n_entreprises integer := 0;
  n_produits integer := 0;
  n_photos integer := 0;
begin
  if to_regclass('public.entreprises') is not null then
    execute 'select count(*) from public.entreprises' into n_entreprises;
  end if;
  if to_regclass('public.entreprise_produits') is not null then
    execute 'select count(*) from public.entreprise_produits' into n_produits;
  end if;
  if to_regclass('public.entreprise_photos') is not null then
    execute 'select count(*) from public.entreprise_photos' into n_photos;
  end if;

  raise warning 'ATTENTION : % entreprise(s), % produit(s) et % photo(s) enregistrés seront DÉFINITIVEMENT PERDUS.',
    n_entreprises, n_produits, n_photos;

  if confirmation <> 'OUI' then
    raise exception 'Retour arrière NON confirmé : aucune suppression effectuée. Éditez ce fichier (confirmation := ''OUI'') pour continuer.';
  end if;
end $$;


-- =========================================================
-- 1. SUPPRESSION (uniquement ce que entreprises-vitrine.sql a créé)
--    Les tables enfants d'abord ; les triggers et policies partent avec leurs tables.
-- =========================================================
drop table if exists public.entreprise_photos;
drop table if exists public.entreprise_produits;
drop table if exists public.entreprises;

drop function if exists public.entreprise_photos_limit();
drop function if exists public.entreprises_set_updated_at();
drop function if exists public.entreprise_is_published(uuid);

notify pgrst, 'reload schema';

-- Vérification (lecture seule) : doit renvoyer 0 ligne.
--   select tablename from pg_tables
--    where schemaname = 'public' and tablename in ('entreprises','entreprise_produits','entreprise_photos');
