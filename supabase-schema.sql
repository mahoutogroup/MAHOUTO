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
