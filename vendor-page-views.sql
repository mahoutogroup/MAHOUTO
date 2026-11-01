-- =========================================================
-- « Mes statistiques » du vendeur Sérigraphe : visites de SES produits uniquement
--
-- ► À exécuter À LA MAIN dans Supabase (SQL Editor), d'abord sur le projet de TEST, après relecture.
--   Ce fichier n'est exécuté par aucun script du dépôt.
-- ► IDEMPOTENT (create or replace). Retour arrière : vendor-page-views-rollback.sql.
-- ► Prérequis : page-views-setup.sql (table page_views) et serigraphie-schema.sql
--   (serigraphie_vendors, serigraphie_products, serigraphie_my_approved_vendor_id()).
--
-- Une seule fonction, aucune nouvelle table, AUCUN droit supplémentaire sur page_views
-- (la table reste illisible depuis le navigateur ; la fonction est SECURITY DEFINER).
--
-- Comment le vendeur est identifié (même mécanisme que les policies des produits) :
--   - serigraphie_vendors.user_id (unique) = auth.uid() ;
--   - « vendeur actif » = serigraphie_vendors.status = 'approved'
--     (serigraphie_my_approved_vendor_id() renvoie l'id de la boutique, sinon NULL) ;
--   - un produit appartient au vendeur par serigraphie_products.vendor_id = serigraphie_vendors.id.
-- Le vendeur n'est JAMAIS un paramètre : il est déduit de la session. Aucun paramètre ne permet
-- donc de viser les produits d'un autre vendeur.
--
-- Ce que la fonction renvoie (jsonb) — uniquement des totaux :
--   total_views, unique_visitors, by_day [{day, views, visitors}] (jours à l'heure du Bénin,
--   jours sans visite à 0), top_products [{id, name, views, visitors}] (10 au plus).
-- Elle ne renvoie ni visitor_id, ni source, ni appareil, ni marque, ni donnée d'un autre vendeur.
-- Les visites des deux marques (MAHOUTO+ et MAJESTÉ PRESSE) sont additionnées : c'est le même produit.
-- =========================================================


-- =========================================================
-- 0. VÉRIFICATION DES PRÉREQUIS
-- =========================================================
do $$
begin
  if to_regclass('public.page_views') is null then
    raise exception 'public.page_views introuvable : exécute d''abord page-views-setup.sql';
  end if;
  if to_regprocedure('public.serigraphie_my_approved_vendor_id()') is null
     or to_regclass('public.serigraphie_products') is null then
    raise exception 'Schéma Sérigraphe introuvable : exécute d''abord serigraphie-schema.sql';
  end if;
end $$;


-- =========================================================
-- 1. FONCTION
--    p_from inclus, p_to exclu ; défauts : 7 derniers jours. Période limitée à 93 jours.
-- =========================================================
create or replace function public.vendor_page_views_summary(
  p_from timestamptz default null,
  p_to   timestamptz default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_vendor uuid;
  v_from   timestamptz := coalesce(p_from, now() - interval '7 days');
  v_to     timestamptz := coalesce(p_to, now());
  v_result jsonb;
begin
  -- Doit être connecté
  if auth.uid() is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  -- Doit être un vendeur ACTIF (boutique approuvée) : on récupère SA boutique
  v_vendor := public.serigraphie_my_approved_vendor_id();
  if v_vendor is null then
    raise exception 'Réservé aux vendeurs approuvés' using errcode = '42501';
  end if;

  if v_to <= v_from or v_to - v_from > interval '93 days' then
    raise exception 'Période invalide (93 jours maximum)' using errcode = '22023';
  end if;

  with mine as (
    -- uniquement les visites de pages « produit sérigraphie » dont l'article appartient à CE vendeur
    select pv.visitor_id, pv.created_at, sp.id as product_id, sp.name as product_name
    from public.page_views pv
    join public.serigraphie_products sp
      on sp.id::text = pv.item_id
     and sp.vendor_id = v_vendor
    where pv.page_type = 'serigraphie_product'
      and pv.created_at >= v_from
      and pv.created_at < v_to
  )
  select jsonb_build_object(
    'total_views',     (select count(*) from mine),
    'unique_visitors', (select count(distinct visitor_id) from mine),
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'views', coalesce(v.views, 0), 'visitors', coalesce(v.visitors, 0))
                       order by d.day)
      from generate_series(
             (v_from at time zone 'Africa/Porto-Novo')::date,
             ((v_to - interval '1 microsecond') at time zone 'Africa/Porto-Novo')::date,
             interval '1 day') as g(ts)
      cross join lateral (select g.ts::date as day) d
      left join (
        select (created_at at time zone 'Africa/Porto-Novo')::date as day,
               count(*) as views,
               count(distinct visitor_id) as visitors
        from mine
        group by 1
      ) v on v.day = d.day
    ), '[]'::jsonb),
    'top_products', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.product_id, 'name', t.product_name,
                                          'views', t.views, 'visitors', t.visitors)
                       order by t.views desc, t.visitors desc, t.product_name)
      from (
        select product_id, product_name, count(*) as views, count(distinct visitor_id) as visitors
        from mine
        group by product_id, product_name
        order by count(*) desc, count(distinct visitor_id) desc, product_name
        limit 10
      ) t
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

revoke execute on function public.vendor_page_views_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.vendor_page_views_summary(timestamptz, timestamptz) to authenticated;


-- =========================================================
-- 2. VÉRIFICATIONS (à lancer après exécution, sur le projet de TEST)
-- =========================================================
-- Droit d'exécution : anon = false, authenticated = true :
--   select has_function_privilege('anon', 'public.vendor_page_views_summary(timestamptz, timestamptz)', 'execute'),
--          has_function_privilege('authenticated', 'public.vendor_page_views_summary(timestamptz, timestamptz)', 'execute');
-- page_views reste illisible pour le navigateur (doit échouer avec « permission denied ») :
--   begin; set local role authenticated; select count(*) from public.page_views; rollback;
-- Trouver un compte vendeur approuvé et un compte non vendeur :
--   select v.user_id, v.shop_name, v.status from public.serigraphie_vendors v order by v.created_at desc;
-- Test en tant que VENDEUR (remplacez <UUID_VENDEUR> par son user_id) :
--   begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims',
--                     json_build_object('sub', '<UUID_VENDEUR>', 'role', 'authenticated')::text, true);
--   select public.vendor_page_views_summary();
--   rollback;
-- Test en tant que NON-vendeur ou vendeur non approuvé (doit renvoyer l'erreur 42501) :
--   begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims',
--                     json_build_object('sub', '<UUID_AUTRE_UTILISATEUR>', 'role', 'authenticated')::text, true);
--   select public.vendor_page_views_summary();
--   rollback;
-- Test sans connexion (rôle authenticated sans identité : doit renvoyer 42501 « Connexion requise ») :
--   begin; set local role authenticated; select public.vendor_page_views_summary(); rollback;
