-- =========================================================
-- digital_products.file_path — ÉTAPE 1/2 (SÛRE, purement additive)
--
-- À lancer AVANT de déployer le nouveau code. Ne retire aucun droit :
-- les anciennes pages continuent de fonctionner après ce script.
--
-- Crée :
--   1. la vue publique public.digital_products_public (sans file_path),
--      limitée aux produits disponibles (même règle que la policy
--      "Lecture produits disponibles") ;
--   2. la fonction public.admin_list_digital_products(), réservée aux
--      admins (is_admin()), qui renvoie toutes les colonnes y compris
--      file_path.
--
-- La vue s'exécute avec les droits de son propriétaire (comportement par
-- défaut, security_invoker désactivé) : elle n'a donc pas besoin que
-- anon/authenticated puissent lire la table elle-même.
-- =========================================================

create or replace view public.digital_products_public
with (security_invoker = false) as
select
  id, nom, description, description_longue, type, domaine,
  prix, promotion, disponible, image_url,
  file_name, mime_type, file_size,
  sales_count, created_at, updated_at
from public.digital_products
where disponible = true;

grant select on public.digital_products_public to anon, authenticated;

-- ---------------------------------------------------------
-- Lecture complète (avec file_path) réservée aux admins.
-- ---------------------------------------------------------
create or replace function public.admin_list_digital_products()
 returns setof public.digital_products
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Accès réservé aux administrateurs' using errcode = '42501';
  end if;
  return query
    select * from public.digital_products order by created_at desc;
end;
$function$;

revoke execute on function public.admin_list_digital_products() from public, anon;
grant execute on function public.admin_list_digital_products() to authenticated;
