-- =========================================================
-- Le Sérigraphe by MAJESTÉ PRESSE — schéma SQL (PR 1 sur 3)
--
-- Place de marché : des sérigraphes (vendeurs) publient leurs produits,
-- MAJESTÉ PRESSE encaisse et prélève une commission.
--
-- ► À exécuter À LA MAIN dans Supabase (SQL Editor), après relecture.
--   Ce fichier n'est exécuté par aucun script du dépôt.
-- ► IDEMPOTENT : peut être relancé sans erreur (create ... if not exists,
--   create or replace, drop ... if exists avant chaque create policy /
--   trigger / contrainte, données d'exemple insérées une seule fois).
-- ► N'altère AUCUNE table existante (profiles, digital_products, ...) ;
--   il ne fait que LIRE public.profiles via public.is_admin().
-- ► Prix et montants en FCFA, toujours des entiers (integer).
-- ► PR 1 : catalogue, vendeurs, admin produits. Aucune écriture client sur
--   orders / order_items / payouts (RLS) : les commandes seront créées par
--   l'API serveur (service_role) en PR 2.
--
-- Prérequis : la fonction public.is_admin() de supabase-schema.sql.
-- =========================================================


-- =========================================================
-- 0. VÉRIFICATION DU PRÉREQUIS
-- =========================================================
do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'public.is_admin() introuvable : exécute d''abord supabase-schema.sql';
  end if;
end $$;


-- =========================================================
-- 1. FONCTION DE VALIDATION DES URL D'IMAGES
--    Même regex que profiles_avatar_url_https_check :
--    ^https://[^\s"'<>]+$  (insensible à la casse, comme ~*)
-- =========================================================
create or replace function public.serigraphie_https_only(urls text[])
 returns boolean
 language sql
 immutable
as $function$
  select coalesce(
    bool_and(coalesce(u ~* '^https://[^[:space:]"''<>]+$', false)),
    true
  )
  from unnest(urls) as u;
$function$;


-- =========================================================
-- 2. TABLES
-- =========================================================

-- ---------- Vendeurs ----------
create table if not exists public.serigraphie_vendors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  shop_name text not null,
  whatsapp text not null,
  city text not null,
  description text,
  status text not null default 'pending',
  commission_rate numeric(5,2) not null default 10,
  created_at timestamptz not null default now()
);

alter table public.serigraphie_vendors
  drop constraint if exists serigraphie_vendors_status_check;
alter table public.serigraphie_vendors
  add constraint serigraphie_vendors_status_check
  check (status = any (array['pending'::text, 'approved'::text, 'rejected'::text, 'suspended'::text]));

alter table public.serigraphie_vendors
  drop constraint if exists serigraphie_vendors_commission_rate_check;
alter table public.serigraphie_vendors
  add constraint serigraphie_vendors_commission_rate_check
  check (commission_rate >= 0 and commission_rate <= 50);

-- Garde-fous de longueur / format (évite les valeurs absurdes côté client)
alter table public.serigraphie_vendors
  drop constraint if exists serigraphie_vendors_shop_name_check;
alter table public.serigraphie_vendors
  add constraint serigraphie_vendors_shop_name_check
  check (char_length(btrim(shop_name)) between 2 and 80);

alter table public.serigraphie_vendors
  drop constraint if exists serigraphie_vendors_whatsapp_check;
alter table public.serigraphie_vendors
  add constraint serigraphie_vendors_whatsapp_check
  check (whatsapp ~ '^\+?[0-9 ().-]{6,25}$');

alter table public.serigraphie_vendors
  drop constraint if exists serigraphie_vendors_city_check;
alter table public.serigraphie_vendors
  add constraint serigraphie_vendors_city_check
  check (char_length(btrim(city)) between 2 and 80);

alter table public.serigraphie_vendors
  drop constraint if exists serigraphie_vendors_description_check;
alter table public.serigraphie_vendors
  add constraint serigraphie_vendors_description_check
  check (description is null or char_length(description) <= 1000);

create index if not exists serigraphie_vendors_status_idx
  on public.serigraphie_vendors (status);

-- ---------- Produits ----------
create table if not exists public.serigraphie_products (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.serigraphie_vendors(id) on delete cascade,
  name text not null,
  category text,
  description text,
  price integer not null,
  min_qty integer not null default 1,
  colors text[] not null default '{}',
  images text[] not null default '{}',
  status text not null default 'draft',
  featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.serigraphie_products
  drop constraint if exists serigraphie_products_price_check;
alter table public.serigraphie_products
  add constraint serigraphie_products_price_check check (price >= 0);

alter table public.serigraphie_products
  drop constraint if exists serigraphie_products_min_qty_check;
alter table public.serigraphie_products
  add constraint serigraphie_products_min_qty_check check (min_qty >= 1);

alter table public.serigraphie_products
  drop constraint if exists serigraphie_products_status_check;
alter table public.serigraphie_products
  add constraint serigraphie_products_status_check
  check (status = any (array['draft'::text, 'active'::text, 'archived'::text]));

alter table public.serigraphie_products
  drop constraint if exists serigraphie_products_images_https_check;
alter table public.serigraphie_products
  add constraint serigraphie_products_images_https_check
  check (public.serigraphie_https_only(images));

alter table public.serigraphie_products
  drop constraint if exists serigraphie_products_images_count_check;
alter table public.serigraphie_products
  add constraint serigraphie_products_images_count_check
  check (coalesce(cardinality(images), 0) <= 10);

alter table public.serigraphie_products
  drop constraint if exists serigraphie_products_colors_count_check;
alter table public.serigraphie_products
  add constraint serigraphie_products_colors_count_check
  check (coalesce(cardinality(colors), 0) <= 20);

alter table public.serigraphie_products
  drop constraint if exists serigraphie_products_name_check;
alter table public.serigraphie_products
  add constraint serigraphie_products_name_check
  check (char_length(btrim(name)) between 2 and 120);

alter table public.serigraphie_products
  drop constraint if exists serigraphie_products_description_check;
alter table public.serigraphie_products
  add constraint serigraphie_products_description_check
  check (description is null or char_length(description) <= 4000);

create index if not exists serigraphie_products_vendor_idx
  on public.serigraphie_products (vendor_id);
create index if not exists serigraphie_products_status_idx
  on public.serigraphie_products (status);

-- ---------- Zones de livraison ----------
create table if not exists public.serigraphie_delivery_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  fee integer not null default 0,
  active boolean not null default true
);

alter table public.serigraphie_delivery_zones
  drop constraint if exists serigraphie_delivery_zones_fee_check;
alter table public.serigraphie_delivery_zones
  add constraint serigraphie_delivery_zones_fee_check check (fee >= 0);

-- ---------- Commandes (créées par l'API serveur en PR 2) ----------
create table if not exists public.serigraphie_orders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references auth.users(id) on delete set null,
  vendor_id uuid not null references public.serigraphie_vendors(id) on delete restrict,
  status text not null default 'pending',
  total integer not null default 0,
  delivery_zone text,
  delivery_fee integer not null default 0,
  payment_method text,
  fedapay_transaction_id text unique,
  commission_rate numeric(5,2) not null default 10,
  commission_amount integer not null default 0,
  vendor_amount integer not null default 0,
  payout_status text not null default 'pending',
  created_at timestamptz not null default now()
);

alter table public.serigraphie_orders
  drop constraint if exists serigraphie_orders_amounts_check;
alter table public.serigraphie_orders
  add constraint serigraphie_orders_amounts_check
  check (total >= 0 and delivery_fee >= 0 and commission_amount >= 0 and vendor_amount >= 0);

alter table public.serigraphie_orders
  drop constraint if exists serigraphie_orders_commission_rate_check;
alter table public.serigraphie_orders
  add constraint serigraphie_orders_commission_rate_check
  check (commission_rate >= 0 and commission_rate <= 50);

alter table public.serigraphie_orders
  drop constraint if exists serigraphie_orders_payout_status_check;
alter table public.serigraphie_orders
  add constraint serigraphie_orders_payout_status_check
  check (payout_status = any (array['pending'::text, 'due'::text, 'paid'::text]));

create index if not exists serigraphie_orders_client_idx
  on public.serigraphie_orders (client_id);
create index if not exists serigraphie_orders_vendor_idx
  on public.serigraphie_orders (vendor_id);

-- ---------- Lignes de commande ----------
create table if not exists public.serigraphie_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.serigraphie_orders(id) on delete cascade,
  product_id uuid references public.serigraphie_products(id) on delete set null,
  qty integer not null,
  unit_price integer not null,
  color text
);

alter table public.serigraphie_order_items
  drop constraint if exists serigraphie_order_items_amounts_check;
alter table public.serigraphie_order_items
  add constraint serigraphie_order_items_amounts_check
  check (qty >= 1 and unit_price >= 0);

create index if not exists serigraphie_order_items_order_idx
  on public.serigraphie_order_items (order_id);

-- ---------- Reversements aux vendeurs ----------
create table if not exists public.serigraphie_payouts (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.serigraphie_vendors(id) on delete restrict,
  amount integer not null,
  method text,
  reference text,
  paid_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid()
);

alter table public.serigraphie_payouts
  drop constraint if exists serigraphie_payouts_amount_check;
alter table public.serigraphie_payouts
  add constraint serigraphie_payouts_amount_check check (amount > 0);

create index if not exists serigraphie_payouts_vendor_idx
  on public.serigraphie_payouts (vendor_id);


-- =========================================================
-- 3. FONCTIONS D'AIDE POUR LES POLITIQUES RLS
--    SECURITY DEFINER : elles lisent serigraphie_vendors en contournant
--    la RLS, sinon un visiteur anonyme ne pourrait jamais vérifier
--    qu'un vendeur est « approved » (et on éviterait toute récursion).
--    Elles ne renvoient qu'un identifiant / un booléen, jamais de ligne.
-- =========================================================

-- Boutique de l'utilisateur connecté (quel que soit son statut), sinon NULL
create or replace function public.serigraphie_my_vendor_id()
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select id from public.serigraphie_vendors where user_id = auth.uid();
$function$;

-- Boutique de l'utilisateur connecté, seulement si elle est approuvée
create or replace function public.serigraphie_my_approved_vendor_id()
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select id from public.serigraphie_vendors
  where user_id = auth.uid() and status = 'approved';
$function$;

-- Ce vendeur est-il approuvé ? (utilisable par un visiteur anonyme)
create or replace function public.serigraphie_vendor_is_approved(vid uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.serigraphie_vendors
    where id = vid and status = 'approved'
  );
$function$;


-- =========================================================
-- 4. TRIGGERS DE PROTECTION (BEFORE INSERT / UPDATE)
--    Contexte de confiance (même logique que protect_role_column) :
--    SQL Editor / migration / service_role (auth.uid() est NULL ou rôle
--    service_role), ou appelant is_admin().
-- =========================================================

-- Vendeurs : un utilisateur ne peut ni choisir son statut, ni sa commission
create or replace function public.serigraphie_vendors_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null or auth.role() = 'service_role' or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Une demande démarre toujours « pending » avec la commission par défaut,
    -- quoi que le client envoie.
    new.status := 'pending';
    new.commission_rate := 10;
    return new;
  end if;

  if new.status is distinct from old.status then
    raise exception 'Modification du statut vendeur réservée aux administrateurs.';
  end if;
  if new.commission_rate is distinct from old.commission_rate then
    raise exception 'Modification de la commission réservée aux administrateurs.';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'Le propriétaire d''une boutique ne peut pas être modifié.';
  end if;
  return new;
end;
$function$;

drop trigger if exists serigraphie_vendors_guard_trg on public.serigraphie_vendors;
create trigger serigraphie_vendors_guard_trg
  before insert or update on public.serigraphie_vendors
  for each row execute function public.serigraphie_vendors_guard();

-- Produits : « featured » (mis en avant) réservé aux admins ; updated_at auto
create or replace function public.serigraphie_products_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;

  if auth.uid() is null or auth.role() = 'service_role' or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.featured := false;
  elsif new.featured is distinct from old.featured then
    raise exception 'La mise en avant d''un produit est réservée aux administrateurs.';
  end if;
  return new;
end;
$function$;

drop trigger if exists serigraphie_products_guard_trg on public.serigraphie_products;
create trigger serigraphie_products_guard_trg
  before insert or update on public.serigraphie_products
  for each row execute function public.serigraphie_products_guard();


-- =========================================================
-- 5. VUE PUBLIQUE DES BOUTIQUES APPROUVÉES
--    Expose UNIQUEMENT id / nom / ville : jamais le WhatsApp, la
--    commission ni le statut. Vue du propriétaire (contourne la RLS
--    de serigraphie_vendors), limitée aux vendeurs 'approved'.
-- =========================================================
create or replace view public.serigraphie_vendors_public as
  select id, shop_name, city
  from public.serigraphie_vendors
  where status = 'approved';

grant select on public.serigraphie_vendors_public to anon, authenticated;


-- =========================================================
-- 6. ROW LEVEL SECURITY
-- =========================================================
alter table public.serigraphie_vendors        enable row level security;
alter table public.serigraphie_products       enable row level security;
alter table public.serigraphie_delivery_zones enable row level security;
alter table public.serigraphie_orders         enable row level security;
alter table public.serigraphie_order_items    enable row level security;
alter table public.serigraphie_payouts        enable row level security;

-- ---------- serigraphie_vendors ----------
drop policy if exists "serigraphie_vendors_own_select" on public.serigraphie_vendors;
create policy "serigraphie_vendors_own_select" on public.serigraphie_vendors
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "serigraphie_vendors_own_insert" on public.serigraphie_vendors;
create policy "serigraphie_vendors_own_insert" on public.serigraphie_vendors
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');

-- Le vendeur peut corriger ses coordonnées ; le trigger interdit tout
-- changement de status / commission_rate / user_id sauf is_admin().
drop policy if exists "serigraphie_vendors_own_update" on public.serigraphie_vendors;
create policy "serigraphie_vendors_own_update" on public.serigraphie_vendors
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "serigraphie_vendors_admin_all" on public.serigraphie_vendors;
create policy "serigraphie_vendors_admin_all" on public.serigraphie_vendors
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- serigraphie_products ----------
drop policy if exists "serigraphie_products_public_read" on public.serigraphie_products;
create policy "serigraphie_products_public_read" on public.serigraphie_products
  for select to anon, authenticated
  using (status = 'active' and public.serigraphie_vendor_is_approved(vendor_id));

drop policy if exists "serigraphie_products_vendor_select" on public.serigraphie_products;
create policy "serigraphie_products_vendor_select" on public.serigraphie_products
  for select to authenticated
  using (vendor_id = public.serigraphie_my_approved_vendor_id());

drop policy if exists "serigraphie_products_vendor_insert" on public.serigraphie_products;
create policy "serigraphie_products_vendor_insert" on public.serigraphie_products
  for insert to authenticated
  with check (vendor_id = public.serigraphie_my_approved_vendor_id());

drop policy if exists "serigraphie_products_vendor_update" on public.serigraphie_products;
create policy "serigraphie_products_vendor_update" on public.serigraphie_products
  for update to authenticated
  using (vendor_id = public.serigraphie_my_approved_vendor_id())
  with check (vendor_id = public.serigraphie_my_approved_vendor_id());

drop policy if exists "serigraphie_products_vendor_delete" on public.serigraphie_products;
create policy "serigraphie_products_vendor_delete" on public.serigraphie_products
  for delete to authenticated
  using (vendor_id = public.serigraphie_my_approved_vendor_id());

drop policy if exists "serigraphie_products_admin_all" on public.serigraphie_products;
create policy "serigraphie_products_admin_all" on public.serigraphie_products
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- serigraphie_delivery_zones ----------
drop policy if exists "serigraphie_zones_public_read" on public.serigraphie_delivery_zones;
create policy "serigraphie_zones_public_read" on public.serigraphie_delivery_zones
  for select to anon, authenticated
  using (active = true);

drop policy if exists "serigraphie_zones_admin_all" on public.serigraphie_delivery_zones;
create policy "serigraphie_zones_admin_all" on public.serigraphie_delivery_zones
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- serigraphie_orders (aucune écriture client) ----------
drop policy if exists "serigraphie_orders_client_select" on public.serigraphie_orders;
create policy "serigraphie_orders_client_select" on public.serigraphie_orders
  for select to authenticated
  using (client_id = auth.uid());

drop policy if exists "serigraphie_orders_vendor_select" on public.serigraphie_orders;
create policy "serigraphie_orders_vendor_select" on public.serigraphie_orders
  for select to authenticated
  using (vendor_id = public.serigraphie_my_vendor_id());

drop policy if exists "serigraphie_orders_admin_all" on public.serigraphie_orders;
create policy "serigraphie_orders_admin_all" on public.serigraphie_orders
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- serigraphie_order_items (aucune écriture client) ----------
-- La sous-requête s'exécute avec la RLS de l'appelant : une ligne n'est
-- visible que si la commande parente l'est (client ou vendeur concerné).
drop policy if exists "serigraphie_order_items_select" on public.serigraphie_order_items;
create policy "serigraphie_order_items_select" on public.serigraphie_order_items
  for select to authenticated
  using (exists (
    select 1 from public.serigraphie_orders o where o.id = order_id
  ));

drop policy if exists "serigraphie_order_items_admin_all" on public.serigraphie_order_items;
create policy "serigraphie_order_items_admin_all" on public.serigraphie_order_items
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- serigraphie_payouts ----------
drop policy if exists "serigraphie_payouts_vendor_select" on public.serigraphie_payouts;
create policy "serigraphie_payouts_vendor_select" on public.serigraphie_payouts
  for select to authenticated
  using (vendor_id = public.serigraphie_my_vendor_id());

drop policy if exists "serigraphie_payouts_admin_all" on public.serigraphie_payouts;
create policy "serigraphie_payouts_admin_all" on public.serigraphie_payouts
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- =========================================================
-- 7. ZONES DE LIVRAISON PAR DÉFAUT (EXEMPLES À ADAPTER)
--    Insérées une seule fois (relançable sans doublon).
--    Les frais sont des valeurs d'EXEMPLE : modifie-les depuis le
--    SQL Editor ou une future page admin avant la mise en ligne.
-- =========================================================
insert into public.serigraphie_delivery_zones (name, city, fee, active)
select v.name, v.city, v.fee, true
from (values
  ('Cotonou — centre',          'Cotonou',      1000),
  ('Abomey-Calavi / Godomey',   'Abomey-Calavi', 1500),
  ('Porto-Novo',                'Porto-Novo',   2500)
) as v(name, city, fee)
where not exists (
  select 1 from public.serigraphie_delivery_zones z
  where z.name = v.name and z.city = v.city
);


-- =========================================================
-- 8. VÉRIFICATIONS (à lancer après exécution — lecture seule)
-- =========================================================
-- RLS activée sur les 6 tables (rowsecurity doit valoir true partout) :
--   select tablename, rowsecurity from pg_tables
--    where schemaname = 'public' and tablename like 'serigraphie\_%' escape '\'
--    order by 1;
--
-- Politiques créées :
--   select tablename, policyname, cmd, roles from pg_policies
--    where schemaname = 'public' and tablename like 'serigraphie\_%' escape '\'
--    order by tablename, policyname;
