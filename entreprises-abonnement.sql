-- =========================================================
-- MAHOUTO+ — Abonnement payant des vitrines d'entreprise (forfaits de jours)
--
-- Une vitrine n'est visible publiquement que si :
--     published = true  ET  (offerte = true  OU  expire_le > now())
-- Chaque paiement FedaPay CONFIRMÉ par le webhook serveur ajoute les jours payés
-- à expire_le (à partir de la plus grande valeur entre maintenant et l'ancienne
-- date : les paiements se cumulent). Pas de prélèvement automatique. À
-- l'expiration rien n'est supprimé : la vitrine redevient visible au paiement
-- suivant. Aucune tâche planifiée : l'expiration est calculée à la lecture.
--
-- ► À exécuter À LA MAIN dans Supabase (SQL Editor), après relecture, d'abord
--   sur le projet de TEST. Ce fichier n'est exécuté par aucun script du dépôt.
-- ► IDEMPOTENT : peut être relancé sans erreur (add column if not exists,
--   create table if not exists, create or replace, drop ... if exists avant
--   chaque create policy / trigger / contrainte).
-- ► ⚠️ Dès l'exécution, les vitrines DÉJÀ PUBLIÉES (expire_le vide, offerte = false)
--   deviennent INVISIBLES. Pour les garder en ligne, exécutez ensuite (ou
--   tout de suite après) le fichier SÉPARÉ entreprises-abonnement-offrir-existantes.sql.
-- ► AUCUN forfait par défaut : entreprise_forfaits est créée VIDE ; les forfaits
--   (libellé, jours, montant, actif) se saisissent depuis admin/vitrines.html.
-- ► Ordre conseillé : 1) ce fichier, 2) (facultatif) le fichier « offrir existantes »,
--   3) déployer le code.
--
-- Prérequis : entreprises-vitrine.sql (tables entreprises, entreprise_produits,
-- entreprise_photos, fonction entreprise_is_published) et public.is_admin().
--
-- Retour arrière : entreprises-abonnement-rollback.sql
-- =========================================================


-- =========================================================
-- 0. VÉRIFICATION DES PRÉREQUIS
-- =========================================================
do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'public.is_admin() introuvable : exécute d''abord supabase-schema.sql';
  end if;
  if to_regclass('public.entreprises') is null
     or to_regclass('public.entreprise_produits') is null
     or to_regclass('public.entreprise_photos') is null
     or to_regprocedure('public.entreprise_is_published(uuid)') is null then
    raise exception 'Tables ou fonctions des vitrines introuvables : exécute d''abord entreprises-vitrine.sql';
  end if;
end $$;


-- =========================================================
-- 1. COLONNES D'ABONNEMENT SUR public.entreprises
--    expire_le : NULL = jamais payée. offerte : vitrine exonérée (gratuite).
--    Seuls le service_role (webhook) et is_admin() peuvent les modifier (trigger du §4).
-- =========================================================
alter table public.entreprises add column if not exists expire_le timestamptz;
alter table public.entreprises add column if not exists offerte boolean not null default false;


-- =========================================================
-- 2. TABLES
-- =========================================================

-- ---------- Forfaits (modifiables sans redéployer, par l'admin seulement) ----------
create table if not exists public.entreprise_forfaits (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  libelle text not null,
  jours integer not null,
  montant integer not null,
  actif boolean not null default false,
  ordre integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.entreprise_forfaits drop constraint if exists entreprise_forfaits_code_check;
alter table public.entreprise_forfaits
  add constraint entreprise_forfaits_code_check
  check (code ~ '^[a-z0-9_-]{2,30}$');

alter table public.entreprise_forfaits drop constraint if exists entreprise_forfaits_libelle_check;
alter table public.entreprise_forfaits
  add constraint entreprise_forfaits_libelle_check
  check (char_length(btrim(libelle)) between 2 and 60);

-- Jours : entier > 0 (borne haute de bon sens : 10 ans).
alter table public.entreprise_forfaits drop constraint if exists entreprise_forfaits_jours_check;
alter table public.entreprise_forfaits
  add constraint entreprise_forfaits_jours_check
  check (jours > 0 and jours <= 3650);

-- Montant en FCFA : entier > 0 (borne haute de bon sens : 10 millions).
alter table public.entreprise_forfaits drop constraint if exists entreprise_forfaits_montant_check;
alter table public.entreprise_forfaits
  add constraint entreprise_forfaits_montant_check
  check (montant > 0 and montant <= 10000000);

create index if not exists entreprise_forfaits_actif_ordre_idx
  on public.entreprise_forfaits (actif, ordre);

-- ---------- Paiements (historique ; aucune lecture publique) ----------
-- forfait_code, jours et montant sont un INSTANTANÉ pris par le serveur au moment du paiement :
-- une modification ultérieure du forfait n'altère pas l'historique ni un paiement en cours.
-- on delete restrict : une vitrine qui a un historique de paiements ne peut pas être supprimée
-- (traçabilité) ; suppression volontaire par SQL après export.
create table if not exists public.entreprise_paiements (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references public.entreprises(id) on delete restrict,
  forfait_code text,
  jours integer not null,
  montant integer not null,
  fedapay_transaction_id text unique,
  statut text not null default 'en_attente',
  source text not null,
  cree_le timestamptz not null default now(),
  confirme_le timestamptz
);

alter table public.entreprise_paiements drop constraint if exists entreprise_paiements_jours_check;
alter table public.entreprise_paiements
  add constraint entreprise_paiements_jours_check
  check (jours > 0 and jours <= 3650);

alter table public.entreprise_paiements drop constraint if exists entreprise_paiements_montant_check;
alter table public.entreprise_paiements
  add constraint entreprise_paiements_montant_check
  check (montant >= 0);

alter table public.entreprise_paiements drop constraint if exists entreprise_paiements_statut_check;
alter table public.entreprise_paiements
  add constraint entreprise_paiements_statut_check
  check (statut in ('en_attente', 'confirme', 'echoue'));

alter table public.entreprise_paiements drop constraint if exists entreprise_paiements_source_check;
alter table public.entreprise_paiements
  add constraint entreprise_paiements_source_check
  check (source in ('fedapay', 'manuel'));

-- Un paiement FedaPay porte toujours son identifiant de transaction ; un paiement manuel n'en a jamais.
alter table public.entreprise_paiements drop constraint if exists entreprise_paiements_source_tx_check;
alter table public.entreprise_paiements
  add constraint entreprise_paiements_source_tx_check
  check (
    (source = 'fedapay' and fedapay_transaction_id is not null)
    or (source = 'manuel' and fedapay_transaction_id is null)
  );

-- confirme_le est renseigné si et seulement si le paiement est confirmé.
alter table public.entreprise_paiements drop constraint if exists entreprise_paiements_confirme_check;
alter table public.entreprise_paiements
  add constraint entreprise_paiements_confirme_check
  check ((statut = 'confirme') = (confirme_le is not null));

create index if not exists entreprise_paiements_entreprise_idx
  on public.entreprise_paiements (entreprise_id, cree_le desc);


-- =========================================================
-- 3. FONCTIONS (search_path fixé)
-- =========================================================

-- Règle de visibilité publique : publiée ET (offerte OU non expirée). L'expiration est évaluée
-- à CHAQUE lecture (now()) : aucune tâche planifiée.
create or replace function public.entreprise_est_visible(p_published boolean, p_offerte boolean, p_expire_le timestamptz)
 returns boolean
 language sql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(p_published, false)
     and (coalesce(p_offerte, false) or (p_expire_le is not null and p_expire_le > now()));
$function$;

grant execute on function public.entreprise_est_visible(boolean, boolean, timestamptz) to anon, authenticated;

-- L'entreprise est-elle visible ? (remplace la version de entreprises-vitrine.sql : elle ne regardait que
-- published). Sert aux policies de lecture des produits et des photos, qui suivent donc la même règle.
create or replace function public.entreprise_is_published(eid uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from public.entreprises e
     where e.id = eid
       and public.entreprise_est_visible(e.published, e.offerte, e.expire_le)
  );
$function$;

revoke all on function public.entreprise_is_published(uuid) from public;
grant execute on function public.entreprise_is_published(uuid) to anon, authenticated;

-- Ajoute des jours à l'abonnement : base = la plus grande valeur entre maintenant et l'ancien expire_le
-- (les paiements se cumulent ; une vitrine expirée repart de maintenant). Fonction INTERNE : aucun rôle
-- ne peut l'appeler directement, seules les fonctions ci-dessous (security definer) y accèdent.
create or replace function public.entreprise_appliquer_jours(p_entreprise_id uuid, p_jours integer)
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
  update public.entreprises
     set expire_le = greatest(coalesce(expire_le, now()), now()) + make_interval(days => p_jours)
   where id = p_entreprise_id
   returning expire_le into v_expire;
  if v_expire is null then
    raise exception 'Vitrine introuvable';
  end if;
  return v_expire;
end;
$function$;

revoke all on function public.entreprise_appliquer_jours(uuid, integer) from public, anon, authenticated, service_role;

-- Confirmation d'un paiement FedaPay, appelée par le webhook SERVEUR (service_role) APRÈS vérification
-- de la signature et relecture de la transaction chez FedaPay. Atomique et idempotent : la ligne est
-- verrouillée (for update) ; seul un paiement « en_attente » peut passer à « confirme » ; un second
-- appel pour la même transaction ne prolonge RIEN. Le montant officiel doit égaler l'instantané.
-- Renvoie un jsonb : { resultat: 'confirme' | 'deja_confirme' | 'montant_incoherent' | 'ignore' | 'introuvable', ... }
create or replace function public.entreprise_confirmer_paiement(p_transaction_id text, p_montant integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v public.entreprise_paiements%rowtype;
  v_expire timestamptz;
begin
  if auth.uid() is not null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Réservé au serveur';
  end if;

  select * into v
    from public.entreprise_paiements
   where fedapay_transaction_id = p_transaction_id
     and source = 'fedapay'
   for update;

  if not found then
    return jsonb_build_object('resultat', 'introuvable');
  end if;
  if v.statut = 'confirme' then
    return jsonb_build_object('resultat', 'deja_confirme');
  end if;
  if v.statut <> 'en_attente' then
    return jsonb_build_object('resultat', 'ignore', 'statut', v.statut);
  end if;
  if p_montant is null or v.montant <> p_montant then
    update public.entreprise_paiements set statut = 'echoue' where id = v.id;
    return jsonb_build_object('resultat', 'montant_incoherent');
  end if;

  update public.entreprise_paiements
     set statut = 'confirme', confirme_le = now()
   where id = v.id;
  v_expire := public.entreprise_appliquer_jours(v.entreprise_id, v.jours);
  return jsonb_build_object('resultat', 'confirme', 'expire_le', v_expire);
end;
$function$;

revoke all on function public.entreprise_confirmer_paiement(text, integer) from public, anon, authenticated;
grant execute on function public.entreprise_confirmer_paiement(text, integer) to service_role;

-- Paiement refusé / annulé chez FedaPay : « en_attente » -> « echoue » (jamais l'inverse d'un « confirme »).
create or replace function public.entreprise_echouer_paiement(p_transaction_id text)
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
  update public.entreprise_paiements
     set statut = 'echoue'
   where fedapay_transaction_id = p_transaction_id
     and source = 'fedapay'
     and statut = 'en_attente';
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$function$;

revoke all on function public.entreprise_echouer_paiement(text) from public, anon, authenticated;
grant execute on function public.entreprise_echouer_paiement(text) to service_role;

-- Prolongation manuelle (paiement reçu en espèces ou par Mobile Money direct) : réservée à is_admin().
-- Enregistre une ligne « manuel » déjà confirmée (montant 0 : la somme reçue n'est pas suivie ici) et
-- ajoute les jours de la même façon que le webhook. Renvoie la nouvelle date d'expiration.
create or replace function public.entreprise_prolonger_manuel(p_entreprise_id uuid, p_jours integer)
 returns timestamptz
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_expire timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs';
  end if;
  if p_jours is null or p_jours < 1 or p_jours > 3650 then
    raise exception 'Nombre de jours invalide (entre 1 et 3650)';
  end if;
  if not exists (select 1 from public.entreprises where id = p_entreprise_id) then
    raise exception 'Vitrine introuvable';
  end if;

  insert into public.entreprise_paiements (entreprise_id, forfait_code, jours, montant, fedapay_transaction_id, statut, source, confirme_le)
  values (p_entreprise_id, null, p_jours, 0, null, 'confirme', 'manuel', now());
  v_expire := public.entreprise_appliquer_jours(p_entreprise_id, p_jours);
  return v_expire;
end;
$function$;

revoke all on function public.entreprise_prolonger_manuel(uuid, integer) from public, anon;
grant execute on function public.entreprise_prolonger_manuel(uuid, integer) to authenticated;


-- =========================================================
-- 4. GARDE : expire_le et offerte ne sont modifiables que par le serveur (service_role) ou un admin
--    (même principe que serigraphie_vendors_guard). Aucun propriétaire n'a d'accès en écriture
--    aujourd'hui ; ce trigger protège aussi contre une future policy trop large.
--    auth.uid() est nul pour l'éditeur SQL de Supabase et les migrations : autorisé.
-- =========================================================
create or replace function public.entreprises_abonnement_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null or coalesce(auth.role(), '') = 'service_role' or public.is_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.expire_le is not null or new.offerte is distinct from false then
      raise exception 'Seul un administrateur peut définir l''abonnement ou la gratuité d''une vitrine.';
    end if;
  elsif new.expire_le is distinct from old.expire_le or new.offerte is distinct from old.offerte then
    raise exception 'Seul un administrateur peut modifier l''abonnement ou la gratuité d''une vitrine.';
  end if;
  return new;
end;
$function$;

drop trigger if exists entreprises_abonnement_guard_trg on public.entreprises;
create trigger entreprises_abonnement_guard_trg
  before insert or update on public.entreprises
  for each row execute function public.entreprises_abonnement_guard();


-- =========================================================
-- 5. ROW LEVEL SECURITY
-- =========================================================
alter table public.entreprise_forfaits  enable row level security;
alter table public.entreprise_paiements enable row level security;

-- Droits de table explicites (la RLS reste la vraie barrière).
revoke all on public.entreprise_forfaits, public.entreprise_paiements from anon, authenticated;
grant select on public.entreprise_forfaits to anon, authenticated;
grant insert, update, delete on public.entreprise_forfaits to authenticated;
grant select, insert, update, delete on public.entreprise_paiements to authenticated;   -- limité à is_admin() par les policies

-- ---------- entreprises : la lecture publique suit la règle de visibilité (publiée ET payée/offerte) ----------
drop policy if exists "entreprises_public_read" on public.entreprises;
create policy "entreprises_public_read" on public.entreprises
  for select to anon, authenticated
  using (public.entreprise_est_visible(published, offerte, expire_le));
-- (entreprises_admin_all est inchangée : l'admin voit et édite tout, y compris les vitrines expirées.)
-- Les policies de lecture des produits et des photos appellent entreprise_is_published() (§3) : inchangées.

-- ---------- entreprise_forfaits : le public ne lit que les forfaits ACTIFS ; l'admin gère tout ----------
drop policy if exists "entreprise_forfaits_public_read" on public.entreprise_forfaits;
create policy "entreprise_forfaits_public_read" on public.entreprise_forfaits
  for select to anon, authenticated
  using (actif = true);

drop policy if exists "entreprise_forfaits_admin_all" on public.entreprise_forfaits;
create policy "entreprise_forfaits_admin_all" on public.entreprise_forfaits
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- entreprise_paiements : admin seulement (aucune lecture publique) ----------
drop policy if exists "entreprise_paiements_admin_all" on public.entreprise_paiements;
create policy "entreprise_paiements_admin_all" on public.entreprise_paiements
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Oblige l'API Supabase (PostgREST) à relire le schéma.
notify pgrst, 'reload schema';


-- =========================================================
-- 6. VÉRIFICATIONS (à lancer après exécution — lecture seule)
-- =========================================================
-- RLS activée sur les 2 nouvelles tables :
--   select tablename, rowsecurity from pg_tables
--    where schemaname = 'public' and tablename in ('entreprise_forfaits','entreprise_paiements') order by 1;
--
-- Policies (4 nouvelles + entreprises_public_read recréée) :
--   select tablename, policyname, cmd, roles, qual from pg_policies
--    where schemaname = 'public' and tablename in ('entreprises','entreprise_forfaits','entreprise_paiements')
--    order by tablename, policyname;
--
-- Fonctions avec search_path fixé (proconfig non vide) :
--   select proname, proconfig from pg_proc where pronamespace = 'public'::regnamespace
--    and proname in ('entreprise_est_visible','entreprise_is_published','entreprise_appliquer_jours',
--                    'entreprise_confirmer_paiement','entreprise_echouer_paiement','entreprise_prolonger_manuel',
--                    'entreprises_abonnement_guard');
--
-- Qui peut exécuter les fonctions sensibles (service_role seul pour confirmer / echouer ; personne pour appliquer_jours) :
--   select p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'execute') as peut_executer
--     from pg_proc p cross join pg_roles r
--    where p.pronamespace = 'public'::regnamespace
--      and p.proname in ('entreprise_confirmer_paiement','entreprise_echouer_paiement','entreprise_appliquer_jours','entreprise_prolonger_manuel')
--      and r.rolname in ('anon','authenticated','service_role')
--    order by p.proname, r.rolname;
--
-- Forfaits : aucun par défaut (la table doit être vide avant votre saisie) :
--   select count(*) from public.entreprise_forfaits;
--
-- Vitrines actuellement visibles publiquement (règle appliquée) :
--   select slug, published, offerte, expire_le,
--          public.entreprise_est_visible(published, offerte, expire_le) as visible
--     from public.entreprises order by slug;
