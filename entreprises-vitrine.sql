-- =========================================================
-- MAHOUTO+ — Vitrine publique d'entreprise (étape 1 : vitrine + administration)
--
-- Une vitrine générique (nom commercial, produits, photos, ville, téléphone /
-- WhatsApp), publiée sur /e/<slug>, gérée par un administrateur depuis
-- admin/vitrines.html. Pas d'espace privé, pas de paiement, pas de contrat.
--
-- ► À exécuter À LA MAIN dans Supabase (SQL Editor), après relecture, d'abord
--   sur le projet de TEST. Ce fichier n'est exécuté par aucun script du dépôt.
-- ► IDEMPOTENT : peut être relancé sans erreur (create ... if not exists,
--   create or replace, drop ... if exists avant chaque create policy /
--   trigger / contrainte).
-- ► NOUVELLES tables uniquement : n'altère AUCUNE table, fonction ou policy
--   existante. Il ne fait que LIRE public.profiles via public.is_admin().
-- ► AUCUNE DONNÉE INITIALE : les tables sont créées VIDES (aucun INSERT).
--   Tout est saisi depuis admin/vitrines.html.
-- ► Prix en FCFA, entiers.
--
-- Prérequis :
--   - public.is_admin()                      (supabase-schema.sql)
--   - public.serigraphie_https_only(text[])  (serigraphie-schema.sql)
--
-- Retour arrière : entreprises-vitrine-rollback.sql
-- =========================================================


-- =========================================================
-- 0. VÉRIFICATION DES PRÉREQUIS
-- =========================================================
do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'public.is_admin() introuvable : exécute d''abord supabase-schema.sql';
  end if;
  if to_regprocedure('public.serigraphie_https_only(text[])') is null then
    raise exception 'public.serigraphie_https_only(text[]) introuvable : exécute d''abord serigraphie-schema.sql';
  end if;
end $$;


-- =========================================================
-- 1. TABLES
--
-- Validation des URL d'images : public.serigraphie_https_only(text[]) accepte
-- UNIQUEMENT les adresses https://res.cloudinary.com/... (https ET hôte
-- Cloudinary ; le nom du « cloud » n'est pas vérifié). Un tableau vide ou NULL
-- est accepté, mais un ÉLÉMENT NULL est refusé : pour une colonne facultative
-- on écrit donc « col is null or serigraphie_https_only(array[col]) ».
--
-- Téléphone : même regex que serigraphie_vendors (^\+?[0-9 ().-]{6,25}$). Le
-- navigateur enregistre le numéro déjà normalisé (+229…) ; la base reste
-- volontairement aussi permissive que les vendeurs.
-- =========================================================

-- ---------- Entreprises ----------
create table if not exists public.entreprises (
  id uuid primary key default gen_random_uuid(),
  slug text unique,
  nom_legal text,
  nom_commercial text,
  description text,
  ville text,
  departement text,
  whatsapp text,
  telephone_appel text,
  logo_url text,
  banner_url text,
  conseil_texte text,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.entreprises drop constraint if exists entreprises_slug_check;
alter table public.entreprises
  add constraint entreprises_slug_check
  check (slug is null or slug ~ '^[a-z0-9-]{2,40}$');

alter table public.entreprises drop constraint if exists entreprises_nom_legal_check;
alter table public.entreprises
  add constraint entreprises_nom_legal_check
  check (nom_legal is null or char_length(btrim(nom_legal)) between 2 and 120);

alter table public.entreprises drop constraint if exists entreprises_nom_commercial_check;
alter table public.entreprises
  add constraint entreprises_nom_commercial_check
  check (nom_commercial is null or char_length(btrim(nom_commercial)) between 2 and 80);

alter table public.entreprises drop constraint if exists entreprises_description_check;
alter table public.entreprises
  add constraint entreprises_description_check
  check (description is null or char_length(description) <= 1500);

alter table public.entreprises drop constraint if exists entreprises_ville_check;
alter table public.entreprises
  add constraint entreprises_ville_check
  check (ville is null or char_length(btrim(ville)) between 2 and 80);

alter table public.entreprises drop constraint if exists entreprises_departement_check;
alter table public.entreprises
  add constraint entreprises_departement_check
  check (departement is null or char_length(btrim(departement)) between 2 and 80);

alter table public.entreprises drop constraint if exists entreprises_whatsapp_check;
alter table public.entreprises
  add constraint entreprises_whatsapp_check
  check (whatsapp is null or whatsapp ~ '^\+?[0-9 ().-]{6,25}$');

alter table public.entreprises drop constraint if exists entreprises_telephone_appel_check;
alter table public.entreprises
  add constraint entreprises_telephone_appel_check
  check (telephone_appel is null or telephone_appel ~ '^\+?[0-9 ().-]{6,25}$');

alter table public.entreprises drop constraint if exists entreprises_logo_url_check;
alter table public.entreprises
  add constraint entreprises_logo_url_check
  check (logo_url is null or (char_length(logo_url) <= 500 and public.serigraphie_https_only(array[logo_url])));

alter table public.entreprises drop constraint if exists entreprises_banner_url_check;
alter table public.entreprises
  add constraint entreprises_banner_url_check
  check (banner_url is null or (char_length(banner_url) <= 500 and public.serigraphie_https_only(array[banner_url])));

alter table public.entreprises drop constraint if exists entreprises_conseil_texte_check;
alter table public.entreprises
  add constraint entreprises_conseil_texte_check
  check (conseil_texte is null or char_length(conseil_texte) <= 300);

-- Une vitrine ne peut être publiée que si son adresse (slug) et son nom commercial sont renseignés.
alter table public.entreprises drop constraint if exists entreprises_published_requires_check;
alter table public.entreprises
  add constraint entreprises_published_requires_check
  check (
    published = false
    or (
      slug is not null and btrim(slug) <> ''
      and nom_commercial is not null and btrim(nom_commercial) <> ''
    )
  );

create index if not exists entreprises_published_idx
  on public.entreprises (published);

-- ---------- Produits ----------
create table if not exists public.entreprise_produits (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references public.entreprises(id) on delete cascade,
  nom text not null,
  description text,
  prix integer,
  unite text,
  disponible boolean not null default true,
  image_url text,
  position integer not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.entreprise_produits drop constraint if exists entreprise_produits_nom_check;
alter table public.entreprise_produits
  add constraint entreprise_produits_nom_check
  check (char_length(btrim(nom)) between 2 and 120);

alter table public.entreprise_produits drop constraint if exists entreprise_produits_description_check;
alter table public.entreprise_produits
  add constraint entreprise_produits_description_check
  check (description is null or char_length(description) <= 600);

-- Prix facultatif (« Prix sur demande » quand il est NULL) ; en FCFA, strictement positif si renseigné.
alter table public.entreprise_produits drop constraint if exists entreprise_produits_prix_check;
alter table public.entreprise_produits
  add constraint entreprise_produits_prix_check
  check (prix is null or prix > 0);

alter table public.entreprise_produits drop constraint if exists entreprise_produits_unite_check;
alter table public.entreprise_produits
  add constraint entreprise_produits_unite_check
  check (unite is null or char_length(unite) <= 30);

alter table public.entreprise_produits drop constraint if exists entreprise_produits_image_url_check;
alter table public.entreprise_produits
  add constraint entreprise_produits_image_url_check
  check (image_url is null or (char_length(image_url) <= 500 and public.serigraphie_https_only(array[image_url])));

create index if not exists entreprise_produits_entreprise_idx
  on public.entreprise_produits (entreprise_id, position);

-- ---------- Photos (galerie) ----------
create table if not exists public.entreprise_photos (
  id uuid primary key default gen_random_uuid(),
  entreprise_id uuid not null references public.entreprises(id) on delete cascade,
  image_url text not null,
  legende text,
  position integer not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.entreprise_photos drop constraint if exists entreprise_photos_image_url_check;
alter table public.entreprise_photos
  add constraint entreprise_photos_image_url_check
  check (char_length(image_url) <= 500 and public.serigraphie_https_only(array[image_url]));

alter table public.entreprise_photos drop constraint if exists entreprise_photos_legende_check;
alter table public.entreprise_photos
  add constraint entreprise_photos_legende_check
  check (legende is null or char_length(legende) <= 80);

create index if not exists entreprise_photos_entreprise_idx
  on public.entreprise_photos (entreprise_id, position);


-- =========================================================
-- 2. FONCTIONS ET TRIGGERS (search_path fixé)
-- =========================================================

-- updated_at automatique sur public.entreprises
create or replace function public.entreprises_set_updated_at()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists entreprises_set_updated_at_trg on public.entreprises;
create trigger entreprises_set_updated_at_trg
  before update on public.entreprises
  for each row execute function public.entreprises_set_updated_at();

-- Limite de 12 photos par entreprise (toutes photos confondues, publiées ou masquées).
-- Un verrou transactionnel par entreprise évite que deux envois simultanés dépassent la limite.
create or replace function public.entreprise_photos_limit()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('entreprise_photos:' || new.entreprise_id::text, 0));
  select count(*) into n
    from public.entreprise_photos
   where entreprise_id = new.entreprise_id
     and id <> new.id;
  if n >= 12 then
    raise exception 'Limite de 12 photos par entreprise atteinte : supprimez une photo avant d''en ajouter une autre.'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

drop trigger if exists entreprise_photos_limit_trg on public.entreprise_photos;
create trigger entreprise_photos_limit_trg
  before insert or update of entreprise_id on public.entreprise_photos
  for each row execute function public.entreprise_photos_limit();

-- L'entreprise est-elle publiée ? (security definer : sert aux policies de lecture des produits et
-- des photos sans dépendre des droits de lecture de l'appelant ; même principe que
-- serigraphie_vendor_is_approved). Ne renvoie qu'un booléen.
create or replace function public.entreprise_is_published(eid uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from public.entreprises e
     where e.id = eid and e.published = true
  );
$function$;

revoke all on function public.entreprise_is_published(uuid) from public;
grant execute on function public.entreprise_is_published(uuid) to anon, authenticated;


-- =========================================================
-- 3. ROW LEVEL SECURITY
--    - lecture anonyme et connectée : seulement ce qui est publié ;
--    - lecture et écriture complètes : public.is_admin() uniquement.
-- =========================================================
alter table public.entreprises         enable row level security;
alter table public.entreprise_produits enable row level security;
alter table public.entreprise_photos   enable row level security;

-- Droits de table explicites (la RLS reste la vraie barrière) : l'anonyme ne peut que lire.
revoke all on public.entreprises, public.entreprise_produits, public.entreprise_photos from anon, authenticated;
grant select on public.entreprises, public.entreprise_produits, public.entreprise_photos to anon, authenticated;
grant insert, update, delete on public.entreprises, public.entreprise_produits, public.entreprise_photos to authenticated;

-- ---------- entreprises ----------
drop policy if exists "entreprises_public_read" on public.entreprises;
create policy "entreprises_public_read" on public.entreprises
  for select to anon, authenticated
  using (published = true);

drop policy if exists "entreprises_admin_all" on public.entreprises;
create policy "entreprises_admin_all" on public.entreprises
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- entreprise_produits ----------
drop policy if exists "entreprise_produits_public_read" on public.entreprise_produits;
create policy "entreprise_produits_public_read" on public.entreprise_produits
  for select to anon, authenticated
  using (published = true and public.entreprise_is_published(entreprise_id));

drop policy if exists "entreprise_produits_admin_all" on public.entreprise_produits;
create policy "entreprise_produits_admin_all" on public.entreprise_produits
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- entreprise_photos ----------
drop policy if exists "entreprise_photos_public_read" on public.entreprise_photos;
create policy "entreprise_photos_public_read" on public.entreprise_photos
  for select to anon, authenticated
  using (published = true and public.entreprise_is_published(entreprise_id));

drop policy if exists "entreprise_photos_admin_all" on public.entreprise_photos;
create policy "entreprise_photos_admin_all" on public.entreprise_photos
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Oblige l'API Supabase (PostgREST) à relire le schéma.
notify pgrst, 'reload schema';


-- =========================================================
-- 4. VÉRIFICATIONS (à lancer après exécution — lecture seule)
-- =========================================================
-- RLS activée sur les 3 tables (rowsecurity doit valoir true partout) :
--   select tablename, rowsecurity from pg_tables
--    where schemaname = 'public' and tablename in ('entreprises','entreprise_produits','entreprise_photos')
--    order by 1;
--
-- Politiques créées (6 attendues : public_read et admin_all sur chaque table) :
--   select tablename, policyname, cmd, roles from pg_policies
--    where schemaname = 'public' and tablename in ('entreprises','entreprise_produits','entreprise_photos')
--    order by tablename, policyname;
--
-- Les fonctions ont bien un search_path fixé (proconfig non vide) :
--   select proname, proconfig from pg_proc
--    where pronamespace = 'public'::regnamespace
--      and proname in ('entreprises_set_updated_at','entreprise_photos_limit','entreprise_is_published');
--
-- Tables vides (aucune donnée initiale) :
--   select (select count(*) from public.entreprises) as entreprises,
--          (select count(*) from public.entreprise_produits) as produits,
--          (select count(*) from public.entreprise_photos) as photos;
