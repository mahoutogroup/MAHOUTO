-- =========================================================
-- MAHOUTO+ — Abonnement par forfaits pour les salons (communautés) payants
--
-- PRINCIPE : tout est AJOUTÉ, rien n'est réécrit.
--   • Les achats à vie existants (public.purchases, product_type = 'salon', status = 'paid') ne sont
--     JAMAIS modifiés, et les 4 règles actuelles de public.messages (lecture, envoi, modification)
--     ne sont PAS touchées : un membre à vie garde exactement les mêmes droits qu'avant.
--   • Un nouveau booléen rooms.abonnement (défaut false) active le mode abonnement, salon par salon.
--     Seul un admin (is_admin()) peut le changer (trigger de garde, §5).
--   • Les paiements d'abonnement vivent dans des tables NOUVELLES (salon_forfaits, salon_abonnements,
--     salon_paiements) et ne créent JAMAIS de ligne « purchases » (sinon ils deviendraient un accès à vie).
--   • Accès aux messages d'un abonné = 3 règles SUPPLÉMENTAIRES (RLS permissives : elles s'additionnent aux
--     règles existantes) valables tant que salon_abonnements.expire_le > now(). L'expiration est évaluée à
--     chaque lecture : aucune tâche planifiée. À l'expiration, lecture ET envoi sont bloqués côté base ;
--     rien n'est supprimé, l'accès revient au paiement suivant (les jours se cumulent).
--
-- ► À exécuter À LA MAIN dans Supabase (SQL Editor), après relecture, d'abord sur un projet de TEST.
--   Ce fichier n'est exécuté par aucun script du dépôt.
-- ► ORDRE : 1) salons-abonnement-verification.sql, PARTIE 1 « AVANT » ; 2) CE fichier ;
--           3) salons-abonnement-verification.sql, PARTIE 2 « APRÈS » ; 4) déployer le code.
-- ► IDEMPOTENT : peut être relancé sans erreur (if not exists, create or replace, drop ... if exists).
-- ► Aucun salon existant n'est modifié : rooms.abonnement vaut false partout après ce fichier.
--
-- ► ⚠️ FORFAIT DE TEST ACTIF : ce fichier insère « Test 1 jour » (1 jour, 100 F) avec actif = TRUE, pour
--   votre essai de bout en bout. Il n'est proposé que dans les salons passés en mode abonnement, donc
--   seulement dans votre salon d'essai. DÉSACTIVEZ-LE (écran des forfaits de admin/rooms.html) AVANT
--   d'activer le mode abonnement sur un vrai salon.
-- ► Les forfaits « 1 mois » et « 3 mois » sont insérés INACTIFS avec des montants d'EXEMPLE FICTIFS :
--   saisissez les vrais prix dans l'admin, puis activez-les. « on conflict do nothing » : relancer ce
--   fichier n'écrase jamais vos prix.
--
-- Prérequis : supabase-schema.sql (tables rooms, messages, purchases) et public.is_admin().
-- Retour arrière : salons-abonnement-rollback.sql
-- =========================================================


-- =========================================================
-- 0. VÉRIFICATION DES PRÉREQUIS
-- =========================================================
do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'public.is_admin() introuvable : exécute d''abord supabase-schema.sql';
  end if;
  if to_regclass('public.rooms') is null
     or to_regclass('public.messages') is null
     or to_regclass('public.purchases') is null then
    raise exception 'Tables rooms / messages / purchases introuvables : exécute d''abord supabase-schema.sql';
  end if;
end $$;


-- =========================================================
-- 1. MODE ABONNEMENT SUR public.rooms
--    abonnement = false partout par défaut : AUCUN salon existant ne change.
--    Un salon en abonnement doit être payant (is_paid = true).
-- =========================================================
alter table public.rooms add column if not exists abonnement boolean not null default false;

alter table public.rooms drop constraint if exists rooms_abonnement_requires_paid;
alter table public.rooms
  add constraint rooms_abonnement_requires_paid
  check (abonnement = false or is_paid = true);


-- =========================================================
-- 2. TABLES
-- =========================================================

-- Forfaits (libellé, durée, prix) : modifiables depuis l'admin, sans redéployer.
create table if not exists public.salon_forfaits (
  id bigint generated always as identity primary key,
  code text not null unique,
  libelle text not null,
  jours integer not null,
  montant integer not null,
  actif boolean not null default false,
  ordre integer not null default 0,
  cree_le timestamptz not null default now()
);

alter table public.salon_forfaits drop constraint if exists salon_forfaits_code_check;
alter table public.salon_forfaits
  add constraint salon_forfaits_code_check
  check (code ~ '^[a-z0-9_-]{2,30}$');

alter table public.salon_forfaits drop constraint if exists salon_forfaits_libelle_check;
alter table public.salon_forfaits
  add constraint salon_forfaits_libelle_check
  check (length(btrim(libelle)) between 1 and 60);

alter table public.salon_forfaits drop constraint if exists salon_forfaits_jours_check;
alter table public.salon_forfaits
  add constraint salon_forfaits_jours_check
  check (jours > 0 and jours <= 3650);

alter table public.salon_forfaits drop constraint if exists salon_forfaits_montant_check;
alter table public.salon_forfaits
  add constraint salon_forfaits_montant_check
  check (montant > 0 and montant <= 10000000);

-- Abonnement en cours d'un membre dans un salon : UNE ligne par (membre, salon).
-- Écrite uniquement par le serveur (fonction salon_appliquer_jours) : aucune règle d'écriture.
create table if not exists public.salon_abonnements (
  user_id uuid not null references auth.users(id) on delete cascade,
  room_id text not null references public.rooms(id) on delete cascade,
  expire_le timestamptz not null,
  maj_le timestamptz not null default now(),
  primary key (user_id, room_id)
);

-- Historique des paiements d'abonnement. Conservé même si le salon ou le compte est supprimé
-- (pas de clé étrangère bloquante) : c'est une trace comptable.
create table if not exists public.salon_paiements (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  room_id text not null,
  forfait_code text,
  jours integer not null,
  montant integer not null,
  fedapay_transaction_id text not null unique,
  statut text not null default 'en_attente',
  cree_le timestamptz not null default now(),
  confirme_le timestamptz
);

alter table public.salon_paiements drop constraint if exists salon_paiements_jours_check;
alter table public.salon_paiements
  add constraint salon_paiements_jours_check
  check (jours > 0 and jours <= 3650);

alter table public.salon_paiements drop constraint if exists salon_paiements_montant_check;
alter table public.salon_paiements
  add constraint salon_paiements_montant_check
  check (montant > 0);

alter table public.salon_paiements drop constraint if exists salon_paiements_statut_check;
alter table public.salon_paiements
  add constraint salon_paiements_statut_check
  check (statut in ('en_attente', 'confirme', 'echoue'));

-- confirme_le est renseigné si et seulement si le paiement est confirmé.
alter table public.salon_paiements drop constraint if exists salon_paiements_confirme_check;
alter table public.salon_paiements
  add constraint salon_paiements_confirme_check
  check ((statut = 'confirme') = (confirme_le is not null));

create index if not exists salon_paiements_user_room_idx
  on public.salon_paiements (user_id, room_id, cree_le desc);
create index if not exists salon_abonnements_room_idx
  on public.salon_abonnements (room_id, expire_le);


-- =========================================================
-- 3. FONCTIONS (toutes avec search_path fixé)
-- =========================================================

-- Le membre connecté a-t-il un abonnement EN COURS dans ce salon ? Sert aux règles d'accès du §6.
-- security definer : lit salon_abonnements sans dépendre des règles de lecture de cette table.
-- Volontairement indépendante de rooms.abonnement : si l'admin désactive le mode abonnement, un
-- membre qui a payé garde son accès jusqu'à l'expiration de ce qu'il a payé.
create or replace function public.salon_abonnement_actif(p_room_id text)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1
      from public.salon_abonnements a
     where a.user_id = auth.uid()
       and a.room_id = p_room_id
       and a.expire_le > now()
  );
$function$;

revoke all on function public.salon_abonnement_actif(text) from public;
grant execute on function public.salon_abonnement_actif(text) to anon, authenticated;

-- Ajoute des jours à l'abonnement d'un membre : base = la plus grande valeur entre maintenant et l'ancien
-- expire_le (les paiements se cumulent ; un abonnement expiré repart de maintenant). Fonction INTERNE :
-- aucun rôle ne peut l'appeler directement.
create or replace function public.salon_appliquer_jours(p_user_id uuid, p_room_id text, p_jours integer)
 returns timestamptz
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_expire timestamptz;
begin
  if p_jours is null or p_jours < 1 or p_jours > 3650 then
    raise exception 'Nombre de jours invalide';
  end if;
  insert into public.salon_abonnements as a (user_id, room_id, expire_le, maj_le)
  values (p_user_id, p_room_id, now() + make_interval(days => p_jours), now())
  on conflict (user_id, room_id) do update
     set expire_le = greatest(a.expire_le, now()) + make_interval(days => p_jours),
         maj_le = now()
  returning expire_le into v_expire;
  return v_expire;
end;
$function$;

revoke all on function public.salon_appliquer_jours(uuid, text, integer) from public, anon, authenticated, service_role;

-- Confirmation d'un paiement FedaPay, appelée par le webhook SERVEUR (service_role) APRÈS vérification
-- de la signature et relecture de la transaction chez FedaPay. Atomique et idempotent : la ligne est
-- verrouillée (for update) ; seul un paiement « en_attente » peut passer à « confirme » ; un second
-- appel pour la même transaction ne prolonge RIEN. Le montant officiel doit égaler l'instantané.
-- Renvoie un jsonb : { resultat: 'confirme' | 'deja_confirme' | 'montant_incoherent' | 'ignore' | 'introuvable', ... }
create or replace function public.salon_confirmer_paiement(p_transaction_id text, p_montant integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v public.salon_paiements%rowtype;
  v_expire timestamptz;
begin
  if auth.uid() is not null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Réservé au serveur';
  end if;

  select * into v
    from public.salon_paiements
   where fedapay_transaction_id = p_transaction_id
   for update;

  if not found then
    return jsonb_build_object('resultat', 'introuvable');
  end if;
  if v.statut = 'confirme' then
    return jsonb_build_object('resultat', 'deja_confirme');
  end if;
  if v.statut <> 'en_attente' or v.user_id is null then
    return jsonb_build_object('resultat', 'ignore', 'statut', v.statut);
  end if;
  if p_montant is null or v.montant <> p_montant then
    update public.salon_paiements set statut = 'echoue' where id = v.id;
    return jsonb_build_object('resultat', 'montant_incoherent');
  end if;

  update public.salon_paiements
     set statut = 'confirme', confirme_le = now()
   where id = v.id;
  v_expire := public.salon_appliquer_jours(v.user_id, v.room_id, v.jours);
  return jsonb_build_object('resultat', 'confirme', 'expire_le', v_expire);
end;
$function$;

revoke all on function public.salon_confirmer_paiement(text, integer) from public, anon, authenticated;
grant execute on function public.salon_confirmer_paiement(text, integer) to service_role;

-- Paiement refusé / annulé chez FedaPay : « en_attente » -> « echoue » (jamais l'inverse d'un « confirme »).
create or replace function public.salon_echouer_paiement(p_transaction_id text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_n integer;
begin
  if auth.uid() is not null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Réservé au serveur';
  end if;
  update public.salon_paiements
     set statut = 'echoue'
   where fedapay_transaction_id = p_transaction_id
     and statut = 'en_attente';
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$function$;

revoke all on function public.salon_echouer_paiement(text) from public, anon, authenticated;
grant execute on function public.salon_echouer_paiement(text) to service_role;

-- Compteurs par salon pour l'écran d'administration : membres à vie, abonnés actifs, abonnés expirés.
-- Réservée à is_admin() ; ne renvoie QUE des nombres (jamais d'identifiant de membre).
create or replace function public.salon_compteurs()
 returns table (room_id text, membres_vie bigint, abonnes_actifs bigint, abonnes_expires bigint)
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs';
  end if;
  return query
    select r.id,
           (select count(distinct p.user_id) from public.purchases p
             where p.course_id = r.id and p.product_type = 'salon' and p.status = 'paid'),
           (select count(*) from public.salon_abonnements a where a.room_id = r.id and a.expire_le > now()),
           (select count(*) from public.salon_abonnements a where a.room_id = r.id and a.expire_le <= now())
      from public.rooms r;
end;
$function$;

revoke all on function public.salon_compteurs() from public, anon;
grant execute on function public.salon_compteurs() to authenticated;


-- =========================================================
-- 4. DROITS DE TABLE
-- =========================================================
revoke all on public.salon_forfaits, public.salon_abonnements, public.salon_paiements from anon, authenticated;
grant select on public.salon_forfaits to anon, authenticated;
grant insert, update, delete on public.salon_forfaits to authenticated;   -- encadré par RLS (admin seulement)
grant select on public.salon_abonnements to authenticated;                 -- encadré par RLS (le sien / admin)
grant select on public.salon_paiements to authenticated;                   -- encadré par RLS (admin seulement)


-- =========================================================
-- 5. GARDE : seul un admin (ou le serveur / l'éditeur SQL) peut changer rooms.abonnement
--    Modèle : entreprises_abonnement_guard. Un créateur de salon gratuit peut modifier son salon,
--    mais jamais activer le mode abonnement.
-- =========================================================
create or replace function public.rooms_abonnement_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null or coalesce(auth.role(), '') = 'service_role' or public.is_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.abonnement is distinct from false then
      raise exception 'Le mode abonnement est réservé aux administrateurs';
    end if;
  elsif new.abonnement is distinct from old.abonnement then
    raise exception 'Le mode abonnement est réservé aux administrateurs';
  end if;
  return new;
end;
$function$;

drop trigger if exists rooms_abonnement_guard_trg on public.rooms;
create trigger rooms_abonnement_guard_trg
  before insert or update on public.rooms
  for each row execute function public.rooms_abonnement_guard();


-- =========================================================
-- 6. ROW LEVEL SECURITY
-- =========================================================
alter table public.salon_forfaits    enable row level security;
alter table public.salon_abonnements enable row level security;
alter table public.salon_paiements   enable row level security;

-- Forfaits : lecture publique des ACTIFS seulement ; écriture réservée à l'admin.
drop policy if exists "salon_forfaits_public_read" on public.salon_forfaits;
create policy "salon_forfaits_public_read" on public.salon_forfaits
  for select to anon, authenticated
  using (actif = true);

drop policy if exists "salon_forfaits_admin_all" on public.salon_forfaits;
create policy "salon_forfaits_admin_all" on public.salon_forfaits
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Abonnements : chacun lit SEULEMENT le sien (pour afficher « expire le… ») ; l'admin lit tout.
-- AUCUNE règle d'écriture : seul le serveur (service_role, via salon_appliquer_jours) écrit.
drop policy if exists "salon_abonnements_own_read" on public.salon_abonnements;
create policy "salon_abonnements_own_read" on public.salon_abonnements
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Paiements : admin seulement (lecture ; écriture par le serveur uniquement).
drop policy if exists "salon_paiements_admin_read" on public.salon_paiements;
create policy "salon_paiements_admin_read" on public.salon_paiements
  for select to authenticated
  using (public.is_admin());

-- Accès aux messages d'un salon pour un ABONNÉ EN COURS : trois règles SUPPLÉMENTAIRES (permissives,
-- elles s'ajoutent par « OU » aux règles existantes, qui ne sont PAS modifiées). Un abonnement expiré
-- n'ouvre rien : sans achat à vie, sans être créateur ni admin, lecture et envoi sont refusés.
drop policy if exists "messages_select_abonnes" on public.messages;
create policy "messages_select_abonnes" on public.messages
  for select
  using (public.salon_abonnement_actif(room_id));

drop policy if exists "messages_insert_abonnes" on public.messages;
create policy "messages_insert_abonnes" on public.messages
  for insert
  with check (auth.uid() = user_id and public.salon_abonnement_actif(room_id));

drop policy if exists "messages_update_abonnes" on public.messages;
create policy "messages_update_abonnes" on public.messages
  for update
  using (auth.uid() = user_id and public.salon_abonnement_actif(room_id))
  with check (auth.uid() = user_id);


-- =========================================================
-- 7. FORFAITS INITIAUX (modifiables ensuite depuis l'admin ; « do nothing » : jamais écrasés)
-- =========================================================
-- ⚠️ « Test 1 jour » : ACTIF, 100 F — à DÉSACTIVER après votre essai, avant d'activer le mode
--    abonnement sur un vrai salon.
-- « 1 mois » et « 3 mois » : INACTIFS, montants d'EXEMPLE FICTIFS (1111 / 2999) — mettez les vrais
--    prix dans l'admin, puis activez.
insert into public.salon_forfaits (code, libelle, jours, montant, actif, ordre) values
  ('test-1-jour', 'Test 1 jour', 1,  100,  true,  0),
  ('1-mois',      '1 mois',      30, 1111, false, 1),
  ('3-mois',      '3 mois',      90, 2999, false, 2)
on conflict (code) do nothing;
