-- =========================================================
-- Compteur de visites ANONYME — MAHOUTO+ et MAJESTÉ PRESSE (même base Supabase)
--
-- ► À exécuter À LA MAIN dans Supabase (SQL Editor), d'abord sur le projet de TEST,
--   après relecture. Ce fichier n'est exécuté par aucun script du dépôt.
-- ► IDEMPOTENT : relançable sans erreur (create ... if not exists, create or replace,
--   drop ... if exists avant chaque policy / trigger / contrainte).
-- ► Retour arrière : page-views-rollback.sql.
--
-- Principe :
--   - Le navigateur INSÈRE une ligne par page vue (clé publique, rôles anon et
--     authenticated), via le client Supabase déjà présent dans les pages. Aucune
--     fonction Vercel.
--   - Personne ne peut LIRE, MODIFIER ni SUPPRIMER cette table depuis le navigateur
--     (aucun privilège, aucune policy). La lecture passe uniquement par les fonctions
--     RPC « admin_page_views_* », qui vérifient public.is_admin() — le même mécanisme
--     que admin_list_digital_products() et les autres RPC admin (profiles.role dans
--     'admin', 'super_admin', 'founder').
--   - AUCUNE donnée personnelle : pas d'identité (même connecté), pas d'IP, pas de
--     user-agent, pas de cookie. Seulement un identifiant visiteur aléatoire (UUID tiré
--     par le navigateur), la page (chemin SANS paramètres d'adresse), le type de page,
--     l'identifiant de l'article, la source (whatsapp, facebook, direct...) et le type
--     d'appareil.
--
-- Prérequis : public.is_admin() (supabase-schema.sql). Pour afficher le nom des produits :
--   public.digital_products, public.serigraphie_products, public.formations.
-- =========================================================


-- =========================================================
-- 0. VÉRIFICATION DES PRÉREQUIS
-- =========================================================
do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'public.is_admin() introuvable : exécute d''abord supabase-schema.sql';
  end if;
  if to_regclass('public.digital_products') is null
     or to_regclass('public.serigraphie_products') is null
     or to_regclass('public.formations') is null then
    raise exception 'Tables digital_products / serigraphie_products / formations introuvables : exécute supabase-schema.sql puis serigraphie-schema.sql';
  end if;
end $$;


-- =========================================================
-- 1. TABLE
-- =========================================================
create table if not exists public.page_views (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  brand       text not null,
  visitor_id  uuid not null,
  path        text not null,
  page_type   text not null,
  item_id     text,
  source      text not null default 'direct',
  device      text not null
);

-- Contraintes de la table (elles s'appliquent quel que soit le rôle qui insère)
alter table public.page_views drop constraint if exists page_views_brand_check;
alter table public.page_views
  add constraint page_views_brand_check
  check (brand = any (array['mahouto'::text, 'majeste'::text]));

alter table public.page_views drop constraint if exists page_views_path_check;
alter table public.page_views
  add constraint page_views_path_check
  check (char_length(path) between 1 and 200 and left(path, 1) = '/');

alter table public.page_views drop constraint if exists page_views_page_type_check;
alter table public.page_views
  add constraint page_views_page_type_check
  check (page_type = any (array['home'::text, 'serigraphie_list'::text, 'serigraphie_product'::text,
                                'product'::text, 'formation'::text, 'other'::text]));

alter table public.page_views drop constraint if exists page_views_item_id_check;
alter table public.page_views
  add constraint page_views_item_id_check
  check (item_id is null or (char_length(item_id) between 1 and 80 and item_id ~ '^[A-Za-z0-9_-]+$'));

-- source : texte court en minuscules (whatsapp, facebook, direct, search, autre, ou un ?src= libre)
alter table public.page_views drop constraint if exists page_views_source_check;
alter table public.page_views
  add constraint page_views_source_check
  check (char_length(source) between 1 and 40 and source ~ '^[a-z0-9_-]+$');

alter table public.page_views drop constraint if exists page_views_device_check;
alter table public.page_views
  add constraint page_views_device_check
  check (device = any (array['mobile'::text, 'desktop'::text, 'tablet'::text]));

-- Index
create index if not exists page_views_brand_created_idx
  on public.page_views (brand, created_at);
create index if not exists page_views_item_created_idx
  on public.page_views (item_id, created_at) where item_id is not null;
create index if not exists page_views_created_idx
  on public.page_views (created_at);                                   -- purge
create index if not exists page_views_visitor_path_idx
  on public.page_views (visitor_id, path, created_at);                 -- anti-doublon (trigger)


-- =========================================================
-- 2. DROITS ET RLS : INSERT SEULEMENT
-- =========================================================
alter table public.page_views enable row level security;

-- On retire TOUT, puis on n'accorde que l'INSERT sur les colonnes que le navigateur remplit
-- (id et created_at sont posés par la base : le client ne peut pas les choisir).
revoke all on public.page_views from public, anon, authenticated;

grant insert (brand, visitor_id, path, page_type, item_id, source, device)
  on public.page_views to anon, authenticated;

-- Aucune policy SELECT / UPDATE / DELETE : ces opérations sont impossibles depuis le navigateur.
drop policy if exists "page_views_insert_public" on public.page_views;
create policy "page_views_insert_public" on public.page_views
  for insert to anon, authenticated
  with check (
    brand = any (array['mahouto', 'majeste'])
    and visitor_id is not null
    and char_length(path) between 1 and 200 and left(path, 1) = '/'
    and page_type = any (array['home', 'serigraphie_list', 'serigraphie_product', 'product', 'formation', 'other'])
    and (item_id is null or (char_length(item_id) between 1 and 80 and item_id ~ '^[A-Za-z0-9_-]+$'))
    and char_length(source) between 1 and 40 and source ~ '^[a-z0-9_-]+$'
    and device = any (array['mobile', 'desktop', 'tablet'])
  );


-- =========================================================
-- 3. GARDE-FOUS À L'INSERTION (trigger, optionnel mais recommandé)
--    a) plafond de TAILLE : si la table dépasse environ 300 000 lignes, les insertions sont ignorées.
--       Calcul : une ligne pèse environ 400 octets index compris
--         - ligne dans la table : ~24 o d'en-tête + id 8 + created_at 8 + visitor_id 16
--           + brand/page_type/source/device ~40 + path ~40 + item_id ~30  = ~170 o ;
--         - 4 index (brand+date, item+date, date, visitor+page+date) : ~55 o chacun = ~220 o ;
--         - total ~390, arrondi à 400 o.
--       300 000 lignes x 400 o = ~120 Mo, soit environ un quart des 500 Mo du plan gratuit de
--       Supabase : le compteur ne peut pas remplir la base, même sous attaque. Le nombre de lignes
--       est une ESTIMATION (pg_class.reltuples, mise à jour par l'autovacuum/ANALYZE) : lecture
--       quasi instantanée, mais en retard de quelques minutes à quelques heures. Une table jamais
--       analysée vaut -1 (ou 0) : sous le plafond, donc insertion permise. La purge à 90 jours
--       (section 5) fait redescendre le compteur.
--    b) plafond global : au-delà de 100 insertions par minute, les lignes sont ignorées
--       (protège le stockage contre un envoi massif). 100 par minute = 6 000 vues par heure, bien
--       au-dessus du trafic normal ; un pic exceptionnel (lien très partagé) perdrait des vues
--       au-delà : relevez la valeur ci-dessous si besoin.
--    c) même visiteur + même page + même article dans les 30 dernières minutes : ligne ignorée
--       (le navigateur le fait déjà ; ceci protège aussi contre un client mal écrit).
--    Les lignes ignorées ne renvoient aucune erreur au navigateur.
--    Limite connue : un script qui change d'identifiant visiteur à chaque envoi peut quand même
--    gonfler les chiffres jusqu'aux plafonds (clé publique : inévitable sans service serveur).
--    SECURITY DEFINER : le trigger doit pouvoir LIRE la table alors que anon ne le peut pas.
--    Son droit d'exécution est retiré à tout le monde (voir plus bas) : seul le déclenchement
--    par la table l'exécute.
-- =========================================================
create or replace function public.page_views_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- a) plafond de taille (estimation, lecture du catalogue : très rapide)
  if (select reltuples::bigint from pg_class where oid = 'public.page_views'::regclass) > 300000 then
    return null;
  end if;

  -- b) plafond global par minute
  if (select count(*) from public.page_views where created_at > now() - interval '1 minute') >= 100 then
    return null;
  end if;

  -- c) même visiteur, même page, même article dans les 30 dernières minutes
  if exists (
    select 1 from public.page_views
    where visitor_id = new.visitor_id
      and path = new.path
      and coalesce(item_id, '') = coalesce(new.item_id, '')
      and created_at > now() - interval '30 minutes'
  ) then
    return null;
  end if;

  return new;
end;
$function$;

-- La fonction du trigger n'est appelable par personne (le trigger se déclenche quand même).
revoke execute on function public.page_views_guard() from public, anon, authenticated;

drop trigger if exists page_views_guard_trg on public.page_views;
create trigger page_views_guard_trg
  before insert on public.page_views
  for each row execute function public.page_views_guard();


-- =========================================================
-- 4. FONCTIONS RPC RÉSERVÉES À L'ADMIN
--    Même mécanisme que admin_list_digital_products() : if not public.is_admin() -> erreur 42501.
--    search_path fixé. Droit d'exécution : seulement « authenticated » (jamais anon).
--    Paramètres : p_from inclus, p_to exclu (timestamptz) ; p_brand = 'mahouto', 'majeste'
--    ou NULL / 'all' pour les deux. Période limitée à 93 jours (conservation : 90 jours).
--    Les jours sont calculés à l'heure du Bénin (Africa/Porto-Novo, UTC+1, sans heure d'été).
-- =========================================================

-- ---------- Résumé : visites, visiteurs uniques, par jour ----------
create or replace function public.admin_page_views_summary(
  p_from timestamptz default null,
  p_to   timestamptz default null,
  p_brand text default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_from  timestamptz := coalesce(p_from, now() - interval '7 days');
  v_to    timestamptz := coalesce(p_to, now());
  v_brand text := case when p_brand is null or p_brand = 'all' then null else p_brand end;
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Accès réservé aux administrateurs' using errcode = '42501';
  end if;
  if v_brand is not null and v_brand not in ('mahouto', 'majeste') then
    raise exception 'Marque invalide' using errcode = '22023';
  end if;
  if v_to <= v_from or v_to - v_from > interval '93 days' then
    raise exception 'Période invalide (93 jours maximum)' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'total_views',     (select count(*) from public.page_views
                         where created_at >= v_from and created_at < v_to
                           and (v_brand is null or brand = v_brand)),
    'unique_visitors', (select count(distinct visitor_id) from public.page_views
                         where created_at >= v_from and created_at < v_to
                           and (v_brand is null or brand = v_brand)),
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
        from public.page_views
        where created_at >= v_from and created_at < v_to
          and (v_brand is null or brand = v_brand)
        group by 1
      ) v on v.day = d.day
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

-- ---------- Articles les plus vus (avec leur nom) ----------
create or replace function public.admin_page_views_top_items(
  p_from timestamptz default null,
  p_to   timestamptz default null,
  p_brand text default null,
  p_limit integer default 20)
 returns table (item_id text, page_type text, item_name text, views bigint, unique_visitors bigint)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_from  timestamptz := coalesce(p_from, now() - interval '7 days');
  v_to    timestamptz := coalesce(p_to, now());
  v_brand text := case when p_brand is null or p_brand = 'all' then null else p_brand end;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  if not public.is_admin() then
    raise exception 'Accès réservé aux administrateurs' using errcode = '42501';
  end if;
  if v_brand is not null and v_brand not in ('mahouto', 'majeste') then
    raise exception 'Marque invalide' using errcode = '22023';
  end if;
  if v_to <= v_from or v_to - v_from > interval '93 days' then
    raise exception 'Période invalide (93 jours maximum)' using errcode = '22023';
  end if;

  return query
    select pv.item_id,
           pv.page_type,
           coalesce(dp.nom, sp.name, f.nom) as item_name,
           count(*) as views,
           count(distinct pv.visitor_id) as unique_visitors
    from public.page_views pv
    left join public.digital_products dp
           on pv.page_type = 'product' and dp.id::text = pv.item_id
    left join public.serigraphie_products sp
           on pv.page_type = 'serigraphie_product' and sp.id::text = pv.item_id
    left join public.formations f
           on pv.page_type = 'formation' and f.id::text = pv.item_id
    where pv.item_id is not null
      and pv.created_at >= v_from and pv.created_at < v_to
      and (v_brand is null or pv.brand = v_brand)
    group by pv.item_id, pv.page_type, dp.nom, sp.name, f.nom
    order by views desc, unique_visitors desc, pv.item_id
    limit v_limit;
end;
$function$;

-- ---------- Sources et appareils ----------
create or replace function public.admin_page_views_sources(
  p_from timestamptz default null,
  p_to   timestamptz default null,
  p_brand text default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_from  timestamptz := coalesce(p_from, now() - interval '7 days');
  v_to    timestamptz := coalesce(p_to, now());
  v_brand text := case when p_brand is null or p_brand = 'all' then null else p_brand end;
begin
  if not public.is_admin() then
    raise exception 'Accès réservé aux administrateurs' using errcode = '42501';
  end if;
  if v_brand is not null and v_brand not in ('mahouto', 'majeste') then
    raise exception 'Marque invalide' using errcode = '22023';
  end if;
  if v_to <= v_from or v_to - v_from > interval '93 days' then
    raise exception 'Période invalide (93 jours maximum)' using errcode = '22023';
  end if;

  return jsonb_build_object(
    -- 30 premières sources ; toutes les autres regroupées sous « autres » (visiteurs uniques recalculés,
    -- pas additionnés : un visiteur peut apparaître dans plusieurs sources). « autres » est placé en dernier.
    'by_source', coalesce((
      with s as (
        select source, count(*) as views, count(distinct visitor_id) as visitors,
               row_number() over (order by count(*) desc, source) as rn
        from public.page_views
        where created_at >= v_from and created_at < v_to and (v_brand is null or brand = v_brand)
        group by source
      ), top as (
        select source, views, visitors, 0 as grp, rn as ord from s where rn <= 30
      ), other as (
        select 'autres'::text as source,
               sum(views)::bigint as views,
               (select count(distinct pv.visitor_id) from public.page_views pv
                 where pv.created_at >= v_from and pv.created_at < v_to
                   and (v_brand is null or pv.brand = v_brand)
                   and pv.source in (select s2.source from s s2 where s2.rn > 30))::bigint as visitors,
               1 as grp, 0::bigint as ord
        from s where rn > 30
        having count(*) > 0
      )
      select jsonb_agg(jsonb_build_object('source', u.source, 'views', u.views, 'visitors', u.visitors)
                       order by u.grp, u.ord)
      from (select * from top union all select * from other) u
    ), '[]'::jsonb),
    'by_device', coalesce((
      select jsonb_agg(jsonb_build_object('device', d.device, 'views', d.views, 'visitors', d.visitors)
                       order by d.views desc, d.device)
      from (select device, count(*) as views, count(distinct visitor_id) as visitors
            from public.page_views
            where created_at >= v_from and created_at < v_to and (v_brand is null or brand = v_brand)
            group by device) d
    ), '[]'::jsonb)
  );
end;
$function$;

-- ---------- En direct : visiteurs uniques des 5 dernières minutes ----------
-- (visiteurs ayant ouvert une page depuis 5 minutes : aucune « présence » n'est suivie en continu)
create or replace function public.admin_page_views_live(p_brand text default null)
 returns bigint
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_brand text := case when p_brand is null or p_brand = 'all' then null else p_brand end;
begin
  if not public.is_admin() then
    raise exception 'Accès réservé aux administrateurs' using errcode = '42501';
  end if;
  if v_brand is not null and v_brand not in ('mahouto', 'majeste') then
    raise exception 'Marque invalide' using errcode = '22023';
  end if;

  return (select count(distinct visitor_id)
          from public.page_views
          where created_at > now() - interval '5 minutes'
            and (v_brand is null or brand = v_brand));
end;
$function$;

revoke execute on function public.admin_page_views_summary(timestamptz, timestamptz, text) from public, anon;
revoke execute on function public.admin_page_views_top_items(timestamptz, timestamptz, text, integer) from public, anon;
revoke execute on function public.admin_page_views_sources(timestamptz, timestamptz, text) from public, anon;
revoke execute on function public.admin_page_views_live(text) from public, anon;
grant execute on function public.admin_page_views_summary(timestamptz, timestamptz, text) to authenticated;
grant execute on function public.admin_page_views_top_items(timestamptz, timestamptz, text, integer) to authenticated;
grant execute on function public.admin_page_views_sources(timestamptz, timestamptz, text) to authenticated;
grant execute on function public.admin_page_views_live(text) to authenticated;


-- =========================================================
-- 5. PURGE (conservation : 90 jours)
--    Pas d'accès depuis le navigateur (ni anon, ni authenticated, ni admin via l'application).
--    À lancer À LA MAIN dans le SQL Editor :
--        select public.purge_old_page_views();          -- 90 jours par défaut
--    Ou automatiquement avec pg_cron SI l'extension est activée sur votre projet
--    (Database > Extensions) — NON CONFIRMÉ pour votre projet, rien n'est planifié ici :
--        select cron.schedule('purge-page-views', '15 3 * * *', $$select public.purge_old_page_views()$$);
-- =========================================================
create or replace function public.purge_old_page_views(p_days integer default 90)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_deleted bigint;
begin
  if p_days is null or p_days < 1 then
    raise exception 'Nombre de jours invalide' using errcode = '22023';
  end if;
  delete from public.page_views where created_at < now() - make_interval(days => p_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;

revoke execute on function public.purge_old_page_views(integer) from public, anon, authenticated;


-- =========================================================
-- 6. VÉRIFICATIONS (lecture seule / à lancer après exécution, sur le projet de TEST)
-- =========================================================
-- RLS activée (rowsecurity doit valoir true) :
--   select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'page_views';
-- Droits : anon et authenticated ne doivent avoir QUE insert :
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'page_views' order by 1, 2;
-- Lecture impossible pour anon (doit échouer avec « permission denied ») :
--   begin; set local role anon; select count(*) from public.page_views; rollback;
-- Insertion possible pour anon (doit réussir) puis invalide (doit échouer sur la contrainte) :
--   begin; set local role anon;
--   insert into public.page_views (brand, visitor_id, path, page_type, item_id, source, device)
--   values ('majeste', gen_random_uuid(), '/s/test', 'serigraphie_product', 'abc-123', 'whatsapp', 'mobile');
--   rollback;
-- RPC admin refusée pour un non-admin (doit renvoyer l'erreur 42501) :
--   begin; set local role authenticated; select public.admin_page_views_live(); rollback;
-- La fonction du trigger n'est exécutable par personne (doit renvoyer false, false, false) :
--   select has_function_privilege('anon', 'public.page_views_guard()', 'execute'),
--          has_function_privilege('authenticated', 'public.page_views_guard()', 'execute'),
--          has_function_privilege('public', 'public.page_views_guard()', 'execute');
-- Colonnes utilisées par la jointure des noms (top_items). Attendu :
--   digital_products.id text, digital_products.nom text,
--   serigraphie_products.id uuid, serigraphie_products.name text,
--   formations.id text, formations.nom text
--   select table_name, column_name, data_type
--     from information_schema.columns
--    where table_schema = 'public'
--      and ((table_name = 'digital_products'    and column_name in ('id', 'nom'))
--        or (table_name = 'serigraphie_products' and column_name in ('id', 'name'))
--        or (table_name = 'formations'           and column_name in ('id', 'nom')))
--    order by table_name, column_name;
-- Les 4 RPC en tant qu'ADMIN. Remplacez <UUID_ADMIN> par l'id d'un compte admin :
--   select id, role from public.profiles where role in ('admin', 'super_admin', 'founder');
-- puis lancez ce bloc d'un seul coup :
--   begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims',
--                     json_build_object('sub', '<UUID_ADMIN>', 'role', 'authenticated')::text, true);
--   select public.admin_page_views_summary();
--   select * from public.admin_page_views_top_items();
--   select public.admin_page_views_sources();
--   select public.admin_page_views_live();
--   rollback;
-- (sans ligne dans page_views, les compteurs valent 0 et les listes sont vides : c'est normal)
