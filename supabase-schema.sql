-- =========================================================
-- MAHOUTO+ — Schéma Supabase v2
-- Ajoute : liste de salons (rooms) + suivi des messages lus
-- À exécuter dans Supabase > SQL Editor
-- (peut être lancé même si v1 a déjà été exécuté)
-- =========================================================

-- Table des profils (déjà créée en v1, inchangée)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now()
);

-- Table des salons de discussion
create table if not exists public.rooms (
  id text primary key,
  name text not null,
  emoji text not null default '💬',
  color text not null default '#22C55E',
  is_group boolean not null default true,
  created_at timestamptz not null default now()
);

-- Table des messages (v2 : room_id référence maintenant rooms.id)
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  room_id text not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null,
  content text not null default '' check (char_length(content) <= 2000),
  created_at timestamptz not null default now()
);

create index if not exists messages_room_created_idx
  on public.messages (room_id, created_at);

-- Pièces jointes (Cloudinary) — v3
alter table public.messages add column if not exists attachment_url text;
alter table public.messages add column if not exists attachment_type text; -- 'image' | 'video' | 'raw'

alter table public.messages drop constraint if exists messages_content_or_attachment;
alter table public.messages add constraint messages_content_or_attachment
  check (char_length(content) > 0 or attachment_url is not null);

-- Suivi de lecture : dernier instant où l'utilisateur a ouvert le salon
create table if not exists public.read_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  room_id text not null references public.rooms(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, room_id)
);

-- Salons de démarrage (modifiable librement ensuite)
insert into public.rooms (id, name, emoji, color, is_group) values
  ('general', 'Général', '💬', '#22C55E', true),
  ('annonces', 'Annonces MAHOUTO+', '📣', '#FFD700', true),
  ('support', 'Support', '🛠️', '#38BDF8', true)
on conflict (id) do nothing;

-- Suivi des achats de formations (paiement FedaPay)
create table if not exists public.purchases (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id text not null,
  course_name text not null,
  amount integer not null,
  fedapay_transaction_id text unique,
  status text not null default 'pending', -- pending | paid | failed
  fedapay_status text,   -- statut brut renvoyé par l'API FedaPay (approved, declined, canceled...)
  paid_at timestamptz,   -- horodatage de la confirmation réelle du paiement
  created_at timestamptz not null default now()
);

-- v4 : colonnes de vérification ajoutées au webhook sécurisé (sans casser l'existant)
alter table public.purchases add column if not exists fedapay_status text;
alter table public.purchases add column if not exists paid_at timestamptz;

-- Dédoublonnage des événements webhook FedaPay (anti-rejeu / anti double-traitement)
create table if not exists public.webhook_events (
  id text primary key,        -- identifiant d'événement FedaPay (event.id)
  event_type text not null,
  received_at timestamptz not null default now()
);

alter table public.webhook_events enable row level security;
-- Aucune policy définie volontairement : seule la clé service_role
-- (utilisée exclusivement par /api/fedapay-webhook.js) peut y accéder,
-- car elle contourne la RLS. Aucun accès client, anonyme ou authentifié.

alter table public.purchases enable row level security;

drop policy if exists "Lecture achats personnels" on public.purchases;
create policy "Lecture achats personnels" on public.purchases
  for select using (auth.uid() = user_id);

-- Note : les insertions/mises à jour de purchases se font uniquement
-- via les fonctions serverless (clé service_role), qui contournent la RLS.
-- Aucune policy d'insertion n'est donc nécessaire côté client.

-- Sécurité niveau ligne (RLS)
alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.messages enable row level security;
alter table public.read_state enable row level security;

-- Profils : lecture ouverte aux authentifiés, écriture sur son propre profil
drop policy if exists "Lecture profils" on public.profiles;
create policy "Lecture profils" on public.profiles
  for select using (auth.role() = 'authenticated');

drop policy if exists "Ecriture profil personnel" on public.profiles;
create policy "Ecriture profil personnel" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "Mise a jour profil personnel" on public.profiles;
create policy "Mise a jour profil personnel" on public.profiles
  for update using (auth.uid() = id);

-- Rooms : lecture ouverte, création ouverte aux authentifiés (bouton "+")
drop policy if exists "Lecture salons" on public.rooms;
create policy "Lecture salons" on public.rooms
  for select using (auth.role() = 'authenticated');

drop policy if exists "Creation salon" on public.rooms;
create policy "Creation salon" on public.rooms
  for insert with check (auth.role() = 'authenticated');

-- Messages : lecture ouverte, écriture en son propre nom uniquement
drop policy if exists "Lecture messages" on public.messages;
create policy "Lecture messages" on public.messages
  for select using (auth.role() = 'authenticated');

drop policy if exists "Envoi message" on public.messages;
create policy "Envoi message" on public.messages
  for insert with check (auth.uid() = user_id);

-- Read state : chacun ne gère que son propre suivi de lecture
drop policy if exists "Lecture suivi lecture" on public.read_state;
create policy "Lecture suivi lecture" on public.read_state
  for select using (auth.uid() = user_id);

drop policy if exists "Ecriture suivi lecture" on public.read_state;
create policy "Ecriture suivi lecture" on public.read_state
  for insert with check (auth.uid() = user_id);

drop policy if exists "Mise a jour suivi lecture" on public.read_state;
create policy "Mise a jour suivi lecture" on public.read_state
  for update using (auth.uid() = user_id);

-- Realtime sur les messages (pour l'affichage instantané)
alter publication supabase_realtime add table public.messages;

-- =========================================================
-- v5 — CORRECTIF SÉCURITÉ : auto-élévation du rôle profiles
--
-- PROBLÈME : la policy "Mise a jour profil personnel" (ci-dessus)
-- autorise un utilisateur à modifier N'IMPORTE QUELLE colonne de sa
-- propre ligne, y compris "role" — la RLS de Postgres protège des
-- LIGNES, pas des COLONNES. N'importe quel compte authentifié (même
-- une session anonyme via signInAnonymously) pouvait donc s'attribuer
-- lui-même le rôle "founder"/"super_admin"/"admin" avec :
--   supabase.from("profiles").update({ role: "founder" }).eq("id", monId)
--
-- CORRECTIF : un trigger BEFORE UPDATE bloque tout changement de la
-- colonne "role" tant que l'appel ne vient pas de la clé service_role
-- (auth.role() = 'service_role' — utilisée uniquement par les
-- fonctions serverless /api/*.js, jamais exposée au navigateur).
--
-- N'affecte PAS :
--   - la création/mise à jour de profil (ensureProfile, upsert sur
--     id/username) : ces upserts n'envoient jamais "role", donc
--     new.role reste égal à old.role et le trigger laisse passer ;
--   - la mise à jour de l'avatar (profil.html) : ne touche pas "role" ;
--   - toute future route admin serveur qui changerait un rôle via
--     service_role (le trigger l'autorise explicitement).
-- =========================================================

create or replace function public.prevent_profile_role_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.role is distinct from old.role then
    if auth.role() is distinct from 'service_role' then
      raise exception
        'Modification du rôle interdite : cette opération doit passer par une route serveur autorisée.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_profile_role_change on public.profiles;
create trigger trg_prevent_profile_role_change
  before update on public.profiles
  for each row execute function public.prevent_profile_role_change();

-- =========================================================
-- v6 — CORRECTIF SÉCURITÉ : formations modifiables côté client
--
-- PROBLÈME : "formations" (catalogue MAHOUTO School / Académie
-- Majesté Presse) était absente de ce schéma versionné, et
-- admin/formations.html écrivait dessus directement avec la clé
-- anonyme (INSERT/UPDATE/DELETE), sans aucune vérification serveur
-- du rôle. Le prix officiel utilisé par /api/fedapay-checkout.js
-- vient de cette même table : la modifier sans contrôle permettait
-- de fixer n'importe quel prix (y compris 0).
--
-- CORRECTIF :
--   - déclaration explicite de la table si elle n'existe pas déjà
--     (si elle existe déjà en production avec d'autres colonnes,
--     ce create table est un no-op — ne touche à aucune donnée) ;
--   - colonnes éditoriales ajoutées avec "add column if not exists" :
--     purement additif, jamais destructeur, no-op si déjà présentes —
--     ces colonnes existent déjà en production (catalogue enrichi :
--     image de couverture, fiche détaillée, objectifs/compétences/
--     programme) mais n'avaient jamais été versionnées ici ;
--   - RLS activée : lecture publique (le catalogue doit rester
--     visible sans connexion, comme le fait déjà school.html) ;
--   - AUCUNE policy d'insertion/mise à jour/suppression : par défaut
--     Postgres refuse alors ces opérations à "anon"/"authenticated" —
--     seule la clé service_role (utilisée uniquement par la route
--     /api/admin/formations.js) peut désormais écrire.
--
-- IMPORTANT : cette section ne fait AUCUN drop column / drop table /
-- truncate. Aucune colonne existante n'est supprimée ni modifiée.
-- =========================================================

create table if not exists public.formations (
  id text primary key,
  provider text not null,
  nom text not null,
  description text,
  emoji text not null default '📘',
  prix integer not null,
  promotion integer,
  disponible boolean not null default true,
  created_at timestamptz not null default now()
);

-- Colonnes éditoriales (fiche complète, catalogue enrichi) — ajoutées
-- sur main (admin/formations.html, school.html, formation-detail.html,
-- academie-majestepresse.html) directement en base, jamais versionnées
-- jusqu'ici. Ajout purement additif, compatible avec les données déjà
-- en production.
alter table public.formations add column if not exists image_url text;
alter table public.formations add column if not exists description_longue text;
alter table public.formations add column if not exists domaine text;
alter table public.formations add column if not exists duree text;
alter table public.formations add column if not exists niveau text;
alter table public.formations add column if not exists formateur text;
alter table public.formations add column if not exists objectifs text;
alter table public.formations add column if not exists competences text;
alter table public.formations add column if not exists programme text;

alter table public.formations enable row level security;

drop policy if exists "Lecture formations" on public.formations;
create policy "Lecture formations" on public.formations
  for select using (true);

-- Aucune policy insert/update/delete : réservé à service_role.

-- -------------------------------------------------------
-- Produits numériques (digital_products) et purchases.product_type
-- -------------------------------------------------------
-- Ces éléments existent déjà en production (utilisés par
-- api/fedapay-checkout.js et api/digital-products-download.js) mais
-- n'ont jamais été versionnés dans ce fichier. On documente leur
-- usage connu ici SANS créer/modifier digital_products (sa structure
-- complète — contraintes, colonnes exactes au-delà de celles lues par
-- le code — n'est pas confirmée depuis ce dépôt ; inventer un
-- "create table" ici risquerait de diverger de la vraie table).
--
-- Colonnes de digital_products lues par le code existant :
--   id, nom, prix, promotion, disponible,
--   file_path, file_name, mime_type
-- (bucket Storage privé associé : "digital-products")
--
-- purchases.product_type ('formation' | 'digital_product') : ajout
-- additif avec valeur par défaut, ne touche à aucune ligne existante.
alter table public.purchases add column if not exists product_type text not null default 'formation';

-- =========================================================
-- v7 — CORRECTIF SÉCURITÉ : lecture publique de dm_conversations
--
-- CONSTAT (vérifié directement via pg_policies en production le
-- 2026-09-14, PAS une supposition) : la plupart des policies RLS sur
-- messages/rooms/dm_messages/dm_read_state/hidden_messages/
-- dm_hidden_messages sont déjà correctement restreintes au
-- propriétaire ou aux participants — bien mieux que ne le laissait
-- supposer ce fichier, resté en retard sur la production.
--
-- UNE exception réelle : dm_conversations avait DEUX policies SELECT
-- permissives, combinées en OR par Postgres :
--   "Allow public read dm_conversations"  -> qual = true
--   "dm_conversations_participants_only"  -> qual = (auth.uid() = user_one OR auth.uid() = user_two)
-- La première rendait la seconde totalement inutile : n'importe quel
-- utilisateur authentifié pouvait lister TOUTES les conversations
-- privées du système (qui parle à qui). Les messages eux-mêmes
-- (dm_messages) restaient protégés — seule cette métadonnée fuitait.
--
-- CORRECTIF : suppression de la policy permissive. La policy stricte
-- "dm_conversations_participants_only" suffit et reste en place.
--
-- Nettoyage secondaire (faible sévérité) : "Creation salon" sur rooms
-- permettait d'insérer un salon sans que created_by corresponde à
-- l'auteur réel (elle coexistait avec rooms_insert_own, qui fait ce
-- contrôle correctement et couvre déjà l'usage réel du code).
-- =========================================================

drop policy if exists "Allow public read dm_conversations" on public.dm_conversations;
drop policy if exists "Creation salon" on public.rooms;
