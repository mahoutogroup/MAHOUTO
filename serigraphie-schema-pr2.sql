-- =========================================================
-- Le Sérigraphe by MAJESTÉ PRESSE — schéma SQL (PR 2 sur 3)
-- Commande, paiement FedaPay, confirmation, admin des commandes.
--
-- ► À exécuter À LA MAIN dans Supabase (SQL Editor), APRÈS serigraphie-schema.sql
--   (PR 1). Ce fichier n'est exécuté par aucun script du dépôt et ne modifie pas
--   serigraphie-schema.sql.
-- ► IDEMPOTENT : relançable sans erreur (add column if not exists, drop ... if
--   exists avant chaque contrainte / policy / trigger, create or replace).
-- ► Montants en FCFA, entiers.
--
-- Ce que fait ce fichier :
--   1. colonnes de commande (adresse, client, notes, date de paiement) ;
--   2. contraintes (statuts, formats, cohérence des montants) ;
--   3. triggers qui rendent les commandes, lignes et reversements
--      infalsifiables côté client, y compris pour un admin connecté :
--        - seules des transitions de statut cohérentes sont possibles ;
--        - « delivered » passe payout_status à 'due' (jamais 'paid') ;
--        - 'paid' (reversement) n'est posé que par serigraphie_record_payout ;
--   4. masquage de la commission au client : la lecture directe de
--      serigraphie_orders lui est retirée, remplacée par deux vues ;
--   5. serigraphie_record_payout() : enregistre un reversement en une transaction.
-- =========================================================


-- =========================================================
-- 0. PRÉREQUIS
-- =========================================================
do $$
begin
  if to_regclass('public.serigraphie_orders') is null
     or to_regclass('public.serigraphie_order_items') is null
     or to_regclass('public.serigraphie_payouts') is null
     or to_regprocedure('public.serigraphie_my_vendor_id()') is null
     or to_regprocedure('public.is_admin()') is null then
    raise exception 'Exécute d''abord supabase-schema.sql puis serigraphie-schema.sql (PR 1).';
  end if;
end $$;


-- =========================================================
-- 1. COLONNES
-- =========================================================
alter table public.serigraphie_orders
  add column if not exists delivery_address text,
  add column if not exists client_name text,
  add column if not exists client_phone text,
  add column if not exists notes text,
  add column if not exists paid_at timestamptz;

-- Nom du produit figé dans la ligne (l'historique survit à la suppression du produit)
alter table public.serigraphie_order_items
  add column if not exists product_name text;

-- Commandes couvertes par un reversement (traçabilité)
alter table public.serigraphie_payouts
  add column if not exists order_ids uuid[] not null default '{}';


-- =========================================================
-- 2. CONTRAINTES
-- =========================================================
alter table public.serigraphie_orders
  drop constraint if exists serigraphie_orders_status_check;
alter table public.serigraphie_orders
  add constraint serigraphie_orders_status_check
  check (status = any (array['pending'::text, 'paid'::text, 'preparing'::text, 'shipped'::text,
                             'delivered'::text, 'cancelled'::text, 'failed'::text]));

-- Une commande se décompose toujours ainsi :
--   total = sous-total produits + frais de livraison
--   sous-total = commission + montant vendeur
alter table public.serigraphie_orders
  drop constraint if exists serigraphie_orders_amounts_consistent_check;
alter table public.serigraphie_orders
  add constraint serigraphie_orders_amounts_consistent_check
  check (total = vendor_amount + commission_amount + delivery_fee);

alter table public.serigraphie_orders
  drop constraint if exists serigraphie_orders_client_phone_check;
alter table public.serigraphie_orders
  add constraint serigraphie_orders_client_phone_check
  check (client_phone is null or client_phone ~ '^\+?[0-9 ().-]{6,25}$');   -- même format que serigraphie_vendors.whatsapp

alter table public.serigraphie_orders
  drop constraint if exists serigraphie_orders_client_name_check;
alter table public.serigraphie_orders
  add constraint serigraphie_orders_client_name_check
  check (client_name is null or char_length(btrim(client_name)) between 2 and 80);

alter table public.serigraphie_orders
  drop constraint if exists serigraphie_orders_delivery_address_check;
alter table public.serigraphie_orders
  add constraint serigraphie_orders_delivery_address_check
  check (delivery_address is null or char_length(btrim(delivery_address)) between 5 and 300);

alter table public.serigraphie_orders
  drop constraint if exists serigraphie_orders_notes_check;
alter table public.serigraphie_orders
  add constraint serigraphie_orders_notes_check
  check (notes is null or char_length(notes) <= 500);

alter table public.serigraphie_order_items
  drop constraint if exists serigraphie_order_items_product_name_check;
alter table public.serigraphie_order_items
  add constraint serigraphie_order_items_product_name_check
  check (product_name is null or char_length(product_name) <= 120);

alter table public.serigraphie_payouts
  drop constraint if exists serigraphie_payouts_method_check;
alter table public.serigraphie_payouts
  add constraint serigraphie_payouts_method_check
  check (method is null or char_length(btrim(method)) between 1 and 40);

alter table public.serigraphie_payouts
  drop constraint if exists serigraphie_payouts_reference_check;
alter table public.serigraphie_payouts
  add constraint serigraphie_payouts_reference_check
  check (reference is null or char_length(reference) <= 120);


-- =========================================================
-- 3. TRIGGERS DE PROTECTION
--    Contexte « DBA » (SQL Editor, migration : AUCUN jeton, donc ni utilisateur
--    ni rôle) : aucune restriction, pour pouvoir corriger à la main. Un appel
--    anonyme porte un jeton (rôle « anon ») : il n'est PAS un contexte DBA.
--    Sinon, seuls le serveur (service_role) et les admins peuvent écrire.
-- =========================================================

-- ---------- Commandes ----------
create or replace function public.serigraphie_orders_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_payout_ctx boolean := coalesce(current_setting('serigraphie.payout', true), '') = 'on';
  v_ok boolean;
begin
  if auth.uid() is null and auth.role() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if not (auth.role() = 'service_role' or public.is_admin()) then
    raise exception 'Écriture sur une commande réservée au serveur et aux administrateurs.';
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Une commande ne se supprime pas (historique financier) : passez-la en « cancelled ».';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'pending' or new.payout_status <> 'pending' or new.paid_at is not null then
      raise exception 'Une commande est toujours créée en statut pending, sans reversement ni paiement.';
    end if;
    return new;
  end if;

  -- UPDATE : identité et montants figés
  if new.client_id is distinct from old.client_id
     or new.vendor_id <> old.vendor_id
     or new.total <> old.total
     or new.delivery_fee <> old.delivery_fee
     or new.commission_rate <> old.commission_rate
     or new.commission_amount <> old.commission_amount
     or new.vendor_amount <> old.vendor_amount
     or new.created_at <> old.created_at then
    raise exception 'Les montants, le vendeur et le client d''une commande ne sont pas modifiables.';
  end if;

  if old.fedapay_transaction_id is not null
     and new.fedapay_transaction_id is distinct from old.fedapay_transaction_id then
    raise exception 'La transaction FedaPay d''une commande ne peut pas être remplacée.';
  end if;

  -- Statut : transitions cohérentes uniquement
  if new.status is distinct from old.status then
    v_ok := (old.status = 'pending'   and new.status in ('paid', 'failed', 'cancelled'))
         or (old.status = 'paid'      and new.status in ('preparing', 'cancelled'))
         or (old.status = 'preparing' and new.status in ('shipped', 'cancelled'))
         or (old.status = 'shipped'   and new.status = 'delivered');
    if not v_ok then
      raise exception 'Transition de statut interdite : % -> %', old.status, new.status;
    end if;
    if new.status = 'paid' then
      new.paid_at := coalesce(new.paid_at, now());
    end if;
    if new.status = 'delivered' then
      new.payout_status := 'due';          -- jamais 'paid' automatiquement
    end if;
  end if;

  if new.paid_at is distinct from old.paid_at
     and not (old.paid_at is null and old.status = 'pending' and new.status = 'paid') then
    raise exception 'La date de paiement ne se modifie pas.';
  end if;

  -- Reversement : 'due' automatique à la livraison ; 'paid' uniquement via serigraphie_record_payout()
  if new.payout_status is distinct from old.payout_status then
    if not ((old.payout_status = 'pending' and new.payout_status = 'due'
             and old.status = 'shipped' and new.status = 'delivered')
            or (old.payout_status = 'due' and new.payout_status = 'paid' and v_payout_ctx)) then
      raise exception 'Le statut de reversement ne peut changer que via la livraison puis serigraphie_record_payout().';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists serigraphie_orders_guard_trg on public.serigraphie_orders;
create trigger serigraphie_orders_guard_trg
  before insert or update or delete on public.serigraphie_orders
  for each row execute function public.serigraphie_orders_guard();

-- ---------- Lignes de commande : écrites par le serveur seulement, sur une commande pending ----------
create or replace function public.serigraphie_order_items_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null and auth.role() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if auth.role() = 'service_role' and tg_op = 'INSERT'
     and exists (select 1 from public.serigraphie_orders o where o.id = new.order_id and o.status = 'pending') then
    return new;
  end if;

  raise exception 'Les lignes de commande sont créées par le serveur et ne se modifient pas.';
end;
$function$;

drop trigger if exists serigraphie_order_items_guard_trg on public.serigraphie_order_items;
create trigger serigraphie_order_items_guard_trg
  before insert or update or delete on public.serigraphie_order_items
  for each row execute function public.serigraphie_order_items_guard();

-- ---------- Reversements : uniquement via serigraphie_record_payout() ----------
create or replace function public.serigraphie_payouts_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null and auth.role() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if coalesce(current_setting('serigraphie.payout', true), '') = 'on' and tg_op = 'INSERT' then
    return new;
  end if;
  raise exception 'Un reversement s''enregistre avec serigraphie_record_payout().';
end;
$function$;

drop trigger if exists serigraphie_payouts_guard_trg on public.serigraphie_payouts;
create trigger serigraphie_payouts_guard_trg
  before insert or update or delete on public.serigraphie_payouts
  for each row execute function public.serigraphie_payouts_guard();


-- =========================================================
-- 4. MASQUER LA COMMISSION AU CLIENT
--    Le client perd la lecture directe de serigraphie_orders / order_items
--    et lit ses commandes via deux vues sans commission, sans montant
--    vendeur, sans statut de reversement. Les vues appartiennent à leur
--    créateur (elles contournent la RLS) et sont filtrées par auth.uid().
-- =========================================================
drop policy if exists "serigraphie_orders_client_select" on public.serigraphie_orders;

create or replace view public.serigraphie_my_orders as
  select o.id, o.status, o.total, o.delivery_zone, o.delivery_fee, o.delivery_address,
         o.client_name, o.client_phone, o.notes, o.payment_method, o.created_at, o.paid_at,
         v.shop_name
  from public.serigraphie_orders o
  join public.serigraphie_vendors v on v.id = o.vendor_id
  where o.client_id = auth.uid();

create or replace view public.serigraphie_my_order_items as
  select oi.order_id, oi.product_id,
         coalesce(oi.product_name, p.name) as product_name,
         oi.qty, oi.unit_price, oi.color
  from public.serigraphie_order_items oi
  join public.serigraphie_orders o on o.id = oi.order_id
  left join public.serigraphie_products p on p.id = oi.product_id
  where o.client_id = auth.uid();

revoke all on public.serigraphie_my_orders from public, anon;
revoke all on public.serigraphie_my_order_items from public, anon;
grant select on public.serigraphie_my_orders to authenticated;
grant select on public.serigraphie_my_order_items to authenticated;

-- Vendeur : lit SES commandes à partir du paiement (pas les paiements abandonnés ou
-- échoués : il n'a pas à voir les coordonnées de clients qui n'ont rien payé).
drop policy if exists "serigraphie_orders_vendor_select" on public.serigraphie_orders;
create policy "serigraphie_orders_vendor_select" on public.serigraphie_orders
  for select to authenticated
  using (vendor_id = public.serigraphie_my_vendor_id() and status not in ('pending', 'failed'));

-- Lignes de commande : plus d'accès client direct ; le vendeur voit celles de SES commandes
-- (la sous-requête applique la RLS de serigraphie_orders), les admins tout.
drop policy if exists "serigraphie_order_items_select" on public.serigraphie_order_items;
drop policy if exists "serigraphie_order_items_vendor_select" on public.serigraphie_order_items;
create policy "serigraphie_order_items_vendor_select" on public.serigraphie_order_items
  for select to authenticated
  using (exists (
    select 1 from public.serigraphie_orders o
    where o.id = order_id and o.vendor_id = public.serigraphie_my_vendor_id()
  ));


-- =========================================================
-- 5. ENREGISTRER UN REVERSEMENT (admins seulement)
--    Une transaction : vérifie les commandes, crée UNE ligne de reversement
--    (somme des montants vendeur) et passe les commandes à 'paid'.
-- =========================================================
create or replace function public.serigraphie_record_payout(
  p_vendor_id uuid, p_order_ids uuid[], p_method text, p_reference text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ids uuid[];
  v_found integer;
  v_amount bigint;
  v_payout uuid;
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;
  if p_vendor_id is null or p_order_ids is null or cardinality(p_order_ids) = 0 then
    raise exception 'Vendeur et commandes obligatoires.';
  end if;
  if p_method is null or char_length(btrim(p_method)) not between 1 and 40 then
    raise exception 'Méthode de reversement invalide.';
  end if;
  if p_reference is not null and char_length(p_reference) > 120 then
    raise exception 'Référence trop longue.';
  end if;

  select array_agg(distinct x) into v_ids from unnest(p_order_ids) as x;

  -- Verrouille les commandes (évite un double reversement en parallèle)
  perform 1 from public.serigraphie_orders where id = any(v_ids) order by id for update;

  select count(*), coalesce(sum(vendor_amount), 0)
    into v_found, v_amount
  from public.serigraphie_orders
  where id = any(v_ids)
    and vendor_id = p_vendor_id
    and status = 'delivered'
    and payout_status = 'due';

  if v_found <> cardinality(v_ids) then
    raise exception 'Chaque commande doit appartenir à ce vendeur, être livrée et à reverser (payout_status = due).';
  end if;
  if v_amount <= 0 then
    raise exception 'Montant à reverser nul.';
  end if;

  perform set_config('serigraphie.payout', 'on', true);   -- valable pour cette transaction seulement

  insert into public.serigraphie_payouts (vendor_id, amount, method, reference, paid_at, created_by, order_ids)
  values (p_vendor_id, v_amount, btrim(p_method), nullif(btrim(coalesce(p_reference, '')), ''), now(), auth.uid(), v_ids)
  returning id into v_payout;

  update public.serigraphie_orders set payout_status = 'paid' where id = any(v_ids);

  perform set_config('serigraphie.payout', 'off', true);
  return v_payout;
end;
$function$;

revoke execute on function public.serigraphie_record_payout(uuid, uuid[], text, text) from public, anon;
grant execute on function public.serigraphie_record_payout(uuid, uuid[], text, text) to authenticated;


-- =========================================================
-- 6. VÉRIFICATIONS (lecture seule, à lancer après exécution)
-- =========================================================
-- Un client ne doit plus avoir de politique de lecture sur serigraphie_orders :
--   select policyname, cmd, roles from pg_policies
--    where schemaname = 'public' and tablename = 'serigraphie_orders' order by 1;
--   (attendu : admin_all, vendor_select — plus de client_select)
--
-- Triggers actifs :
--   select tgname, tgrelid::regclass from pg_trigger
--    where tgname like 'serigraphie\_%' escape '\' and not tgisinternal order by 2, 1;
