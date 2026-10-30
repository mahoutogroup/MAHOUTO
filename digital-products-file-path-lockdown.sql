-- =========================================================
-- digital_products.file_path — ÉTAPE 2/2 (RESTRICTIVE)
--
-- À lancer UNIQUEMENT APRÈS :
--   - l'étape 1 (digital-products-file-path.sql) ;
--   - le déploiement du nouveau code (pages produits.html,
--     produit-detail.html, admin/produits.html, api/produit-og.js).
--
-- Retire à anon et authenticated le droit de lire la colonne file_path
-- (et seulement elle). Les autres colonnes restent lisibles, et les
-- droits INSERT / UPDATE / DELETE ne changent pas : l'admin continue
-- d'écrire file_path, mais ne peut plus le lire que via
-- admin_list_digital_products(). service_role n'est pas concerné
-- (api/digital-products-download.js continue de fonctionner).
--
-- ⚠ Après ce script, un "select *" ou "select file_path" sur
-- public.digital_products avec la clé anon donne "permission denied".
-- ⚠ Toute future colonne ajoutée à la table devra recevoir son propre
-- "grant select (colonne)" pour être lisible côté client.
-- =========================================================

revoke select on public.digital_products from anon, authenticated;

grant select (
  id, nom, description, description_longue, type, domaine,
  prix, promotion, disponible, image_url,
  file_name, mime_type, file_size,
  sales_count, created_at, updated_at
) on public.digital_products to anon, authenticated;

-- Vérification (doit renvoyer false pour anon et authenticated) :
-- select has_column_privilege('anon', 'public.digital_products', 'file_path', 'select');
-- select has_column_privilege('authenticated', 'public.digital_products', 'file_path', 'select');

-- Retour arrière (si besoin) :
-- grant select on public.digital_products to anon, authenticated;
