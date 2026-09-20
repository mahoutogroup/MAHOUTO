-- =========================================================
-- MAHOUTO+ — Schéma Supabase (régénéré le 19/09/2026)
-- Ce fichier reflète fidèlement l'état RÉEL de la base de
-- production, vérifié colonne par colonne, policy par policy,
-- fonction par fonction et trigger par trigger avec l'utilisateur.
-- À exécuter dans Supabase > SQL Editor.
-- Écrit pour pouvoir être relancé sans casser l'existant
-- (create table/policy if not exists, etc.).
--
-- NOTE IMPORTANTE : la table "webhook_events" (dédoublonnage des
-- webhooks FedaPay, mentionnée dans une version antérieure de ce
-- fichier) N'EXISTE PAS en production au moment de cette
-- régénération. Le code de fedapay-webhook.js sait s'en passer
-- (une autre vérification empêche le double-crédit), mais si vous
-- voulez la recréer, demandez la migration séparément.
-- =========================================================


-- =========================================================
-- 1. TABLES
-- =========================================================

-- ---------- Profils ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now(),
  role text not null default 'user',
  avatar_url text
);

alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role = any (array['user'::text, 'admin'::text, 'super_admin'::text, 'founder'::text]));

-- ---------- Salons (messagerie publique) ----------
create table if not exists public.rooms (
  id text primary key,
  name text not null,
  emoji text not null default '💬',
  color text not null default '#22C55E',
  is_group boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

-- ---------- Messages des salons ----------
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  room_id text not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null,
  content text not null default '',
  created_at timestamptz not null default now(),
  attachment_url text,
  attachment_type text, -- 'image' | 'video' | 'audio' | 'raw'
  edited_at timestamptz,
  is_deleted boolean not null default false,
  attachment_name text
);

alter table public.messages
  drop constraint if exists messages_content_or_attachment;
alter table public.messages
  add constraint messages_content_or_attachment
  check (char_length(content) > 0 or attachment_url is not null);

alter table public.messages
  drop constraint if exists messages_content_check;
alter table public.messages
  add constraint messages_content_check
  check (char_length(content) <= 20000);

create index if not exists messages_room_created_idx
  on public.messages (room_id, created_at);

-- ---------- "Supprimer pour moi" — salons ----------
create table if not exists public.hidden_messages (
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id bigint not null references public.messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

-- ---------- Suivi de lecture — salons ----------
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

-- ---------- Conversations privées (DM) ----------
create table if not exists public.dm_conversations (
  id uuid primary key default gen_random_uuid(),
  user_one uuid not null references auth.users(id),
  user_two uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint dm_conversations_user_one_user_two_key unique (user_one, user_two)
);

alter table public.dm_conversations
  drop constraint if exists dm_conversations_order;
alter table public.dm_conversations
  add constraint dm_conversations_order
  check (user_one < user_two);

-- ---------- Messages privés ----------
create table if not exists public.dm_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.dm_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id),
  content text,
  attachment_url text,
  attachment_type text,
  is_deleted boolean not null default false,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  attachment_name text,
  delivered_at timestamptz,
  read_at timestamptz
);

alter table public.dm_messages
  drop constraint if exists dm_messages_content_check;
alter table public.dm_messages
  add constraint dm_messages_content_check
  check (char_length(content) <= 20000);

alter table public.dm_messages
  drop constraint if exists dm_messages_read_after_delivered;
alter table public.dm_messages
  add constraint dm_messages_read_after_delivered
  check (delivered_at is null or read_at is null or read_at >= delivered_at);

alter table public.dm_messages
  drop constraint if exists dm_messages_read_implies_delivered;
alter table public.dm_messages
  add constraint dm_messages_read_implies_delivered
  check (read_at is null or delivered_at is not null);

-- ---------- "Supprimer pour moi" — messages privés ----------
create table if not exists public.dm_hidden_messages (
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id bigint not null references public.dm_messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

-- ---------- Suivi de lecture — messages privés ----------
create table if not exists public.dm_read_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.dm_conversations(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

-- ---------- Formations (MAHOUTO School / Académie Majesté Presse) ----------
create table if not exists public.formations (
  id text primary key,
  provider text not null default 'mahouto_school',
  nom text not null,
  description text,
  emoji text not null default '📘',
  prix integer not null,
  promotion integer,
  disponible boolean not null default true,
  created_at timestamptz not null default now(),
  image_url text,
  description_longue text,
  domaine text,
  duree text,
  niveau text,
  formateur text,
  objectifs text,
  competences text,
  programme text
);

create table if not exists public.formation_modules (
  id bigint generated always as identity primary key,
  formation_id text not null references public.formations(id) on delete cascade,
  titre text not null,
  ordre integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.formation_lessons (
  id bigint generated always as identity primary key,
  module_id bigint not null references public.formation_modules(id) on delete cascade,
  titre text not null,
  type text not null default 'video',
  ordre integer not null default 0,
  is_preview boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.formation_lesson_media (
  lesson_id bigint primary key references public.formation_lessons(id) on delete cascade,
  video_public_id text,
  video_url text,
  pdf_path text,
  duree_secondes integer,
  updated_at timestamptz not null default now()
);

create table if not exists public.course_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id bigint not null references public.formation_lessons(id) on delete cascade,
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

-- ---------- Produits numériques (boutique MAHOUTO+) ----------
create table if not exists public.digital_products (
  id text primary key,
  nom text not null,
  description text,
  description_longue text,
  type text not null,
  domaine text,
  prix integer not null,
  promotion integer,
  disponible boolean not null default true,
  image_url text,
  file_path text,
  file_name text,
  mime_type text,
  file_size bigint,
  sales_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.digital_products
  drop constraint if exists digital_products_type_check;
alter table public.digital_products
  add constraint digital_products_type_check
  check (type = any (array['pdf'::text, 'ebook'::text, 'video'::text, 'audio'::text, 'zip'::text, 'template'::text, 'document'::text, 'other'::text]));

alter table public.digital_products
  drop constraint if exists digital_products_prix_check;
alter table public.digital_products
  add constraint digital_products_prix_check check (prix > 0);

alter table public.digital_products
  drop constraint if exists digital_products_promotion_check;
alter table public.digital_products
  add constraint digital_products_promotion_check
  check (promotion is null or promotion > 0);

-- ---------- Achats (formations + produits numériques, paiement FedaPay) ----------
create table if not exists public.purchases (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id text not null,
  course_name text not null,
  amount integer not null,
  fedapay_transaction_id text unique,
  status text not null default 'pending', -- pending | paid | failed
  created_at timestamptz not null default now(),
  product_type text not null default 'formation', -- 'formation' | 'digital_product'
  fedapay_status text,   -- statut brut renvoyé par l'API FedaPay
  paid_at timestamptz    -- horodatage de la confirmation réelle du paiement
);

alter table public.purchases
  drop constraint if exists purchases_product_type_check;
alter table public.purchases
  add constraint purchases_product_type_check
  check (product_type = any (array['formation'::text, 'digital_product'::text]));

-- ---------- Partage natif (Web Share Target) ----------
create table if not exists public.share_pending (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  mime_type text not null,
  file_size bigint not null default 0,
  attachment_url text not null,
  caption text not null default '',
  title text not null default '',
  shared_url text not null default '',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- ---------- Limitation de débit — /api/share-target.js ----------
create table if not exists public.share_target_rate_limit (
  ip text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 1
);


-- =========================================================
-- 2. FONCTIONS
-- =========================================================

create or replace function public.is_admin()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role in ('admin', 'super_admin', 'founder')
  );
$function$;

create or replace function public.get_public_profile(uid uuid)
 returns table(id uuid, username text, avatar_url text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p.id, p.username, p.avatar_url
  from profiles p
  where p.id = uid;
$function$;

create or replace function public.search_profiles(q text)
 returns table(id uuid, username text, avatar_url text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p.id, p.username, p.avatar_url
  from profiles p
  where p.username ilike '%' || q || '%'
    and p.id != auth.uid()
  order by p.username
  limit 20;
$function$;

create or replace function public.get_or_create_dm_conversation(other_user_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  me uuid := auth.uid();
  lo uuid;
  hi uuid;
  conv_id uuid;
begin
  if me is null then
    raise exception 'Non authentifié';
  end if;

  if me = other_user_id then
    raise exception 'Impossible de créer une conversation avec soi-même';
  end if;

  if me < other_user_id then
    lo := me; hi := other_user_id;
  else
    lo := other_user_id; hi := me;
  end if;

  select id into conv_id from dm_conversations where user_one = lo and user_two = hi;

  if conv_id is null then
    insert into dm_conversations (user_one, user_two) values (lo, hi)
    returning id into conv_id;
  end if;

  return conv_id;
end;
$function$;

create or replace function public.mark_conversation_delivered(p_conversation_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_rows integer;
begin
  if not exists (
    select 1
    from public.dm_conversations c
    where c.id = p_conversation_id
      and (c.user_one = auth.uid() or c.user_two = auth.uid())
  ) then
    return 0;
  end if;

  update public.dm_messages
  set delivered_at = now()
  where conversation_id = p_conversation_id
    and sender_id <> auth.uid()
    and delivered_at is null;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_rows integer;
begin
  if not exists (
    select 1
    from public.dm_conversations c
    where c.id = p_conversation_id
      and (c.user_one = auth.uid() or c.user_two = auth.uid())
  ) then
    return 0;
  end if;

  update public.dm_messages
  set delivered_at = coalesce(delivered_at, now()),
      read_at = now()
  where conversation_id = p_conversation_id
    and sender_id <> auth.uid()
    and read_at is null;

  get diagnostics v_rows = row_count;

  insert into public.dm_read_state (user_id, conversation_id, last_read_at)
  values (auth.uid(), p_conversation_id, now())
  on conflict (user_id, conversation_id) do update set last_read_at = excluded.last_read_at;

  return v_rows;
end;
$function$;

-- Empêche un utilisateur de s'auto-attribuer un rôle plus élevé.
-- NOTE : deux triggers indépendants protègent la colonne "role" en
-- production (voir section 3) — conservés tels quels par fidélité
-- à l'état réel, bien qu'ils fassent un travail proche.
create or replace function public.prevent_profile_role_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'auth'
as $function$
begin
  if new.role is distinct from old.role then
    if auth.role() is distinct from 'service_role' then
      raise exception
        'Modification du rôle interdite : cette opération doit passer par une route serveur autorisée.';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.protect_role_column()
 returns trigger
 language plpgsql
 security definer
as $function$
begin
  -- Contexte de confiance : SQL Editor, migration, ou backend Vercel
  if auth.uid() is null or auth.role() = 'service_role' then
    return new;
  end if;

  -- Nouvelle inscription : le rôle est toujours "user",
  -- même si le client essaie d'envoyer autre chose.
  if TG_OP = 'INSERT' then
    new.role := 'user';
    return new;
  end if;

  -- Mise à jour : on bloque tout changement de rôle,
  -- sauf si l'appelant est déjà admin/super_admin/founder.
  if new.role is distinct from old.role then
    if not exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role in ('admin', 'super_admin', 'founder')
    ) then
      raise exception 'Modification du rôle non autorisée.';
    end if;
  end if;

  return new;
end;
$function$;


-- =========================================================
-- 3. TRIGGERS
-- =========================================================

drop trigger if exists trg_prevent_profile_role_change on public.profiles;
create trigger trg_prevent_profile_role_change
  before update on public.profiles
  for each row execute function public.prevent_profile_role_change();

drop trigger if exists trg_protect_role on public.profiles;
create trigger trg_protect_role
  before insert or update on public.profiles
  for each row execute function public.protect_role_column();


-- =========================================================
-- 4. SÉCURITÉ NIVEAU LIGNE (RLS)
-- =========================================================

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.messages enable row level security;
alter table public.hidden_messages enable row level security;
alter table public.read_state enable row level security;
alter table public.dm_conversations enable row level security;
alter table public.dm_messages enable row level security;
alter table public.dm_hidden_messages enable row level security;
alter table public.dm_read_state enable row level security;
alter table public.formations enable row level security;
alter table public.formation_modules enable row level security;
alter table public.formation_lessons enable row level security;
alter table public.formation_lesson_media enable row level security;
alter table public.course_progress enable row level security;
alter table public.digital_products enable row level security;
alter table public.purchases enable row level security;
alter table public.share_pending enable row level security;
alter table public.share_target_rate_limit enable row level security;

-- ---------- profiles ----------
-- NOTE : "Ecriture/Lecture/Mise a jour profil personnel" (anciennes,
-- en français) et "profiles_insert/select/update_own" (nouvelles)
-- coexistent en prod et font le même travail en double — fidèlement
-- reproduites telles quelles ; un nettoyage éventuel (suppression des
-- anciennes) peut être fait plus tard sans rien casser.
drop policy if exists "Ecriture profil personnel" on public.profiles;
create policy "Ecriture profil personnel" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "Lecture profils" on public.profiles;
create policy "Lecture profils" on public.profiles
  for select using (auth.role() = 'authenticated');

drop policy if exists "Mise a jour profil personnel" on public.profiles;
create policy "Mise a jour profil personnel" on public.profiles
  for update using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ---------- rooms ----------
-- Même remarque : doublons anciens/nouveaux conservés fidèlement.
drop policy if exists "Allow public read rooms" on public.rooms;
create policy "Allow public read rooms" on public.rooms
  for select using (true);

drop policy if exists "Lecture salons" on public.rooms;
create policy "Lecture salons" on public.rooms
  for select using (auth.role() = 'authenticated');

drop policy if exists "rooms_public_read" on public.rooms;
create policy "rooms_public_read" on public.rooms
  for select using (true);

drop policy if exists "rooms_insert_own" on public.rooms;
create policy "rooms_insert_own" on public.rooms
  for insert with check (created_by = auth.uid());

drop policy if exists "rooms_delete_own_or_admin" on public.rooms;
create policy "rooms_delete_own_or_admin" on public.rooms
  for delete using (created_by = auth.uid() or is_admin());

drop policy if exists "rooms_update_own_or_admin" on public.rooms;
create policy "rooms_update_own_or_admin" on public.rooms
  for update using (created_by = auth.uid() or is_admin())
  with check (created_by = auth.uid() or is_admin());

-- ---------- messages ----------
-- Même remarque : doublons anciens/nouveaux conservés fidèlement.
drop policy if exists "Envoi message" on public.messages;
create policy "Envoi message" on public.messages
  for insert with check (auth.uid() = user_id);

drop policy if exists "Lecture messages" on public.messages;
create policy "Lecture messages" on public.messages
  for select using (auth.role() = 'authenticated');

drop policy if exists "messages_insert_own" on public.messages;
create policy "messages_insert_own" on public.messages
  for insert with check (auth.uid() = user_id);

drop policy if exists "messages_public_read" on public.messages;
create policy "messages_public_read" on public.messages
  for select using (true);

drop policy if exists "messages_update_own" on public.messages;
create policy "messages_update_own" on public.messages
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "messages_delete_room_owner_or_admin" on public.messages;
create policy "messages_delete_room_owner_or_admin" on public.messages
  for delete using (
    is_admin() or exists (
      select 1 from rooms
      where rooms.id = messages.room_id and rooms.created_by = auth.uid()
    )
  );

-- ---------- hidden_messages ----------
drop policy if exists "hidden_messages_own_insert" on public.hidden_messages;
create policy "hidden_messages_own_insert" on public.hidden_messages
  for insert with check (auth.uid() = user_id);

drop policy if exists "hidden_messages_own_select" on public.hidden_messages;
create policy "hidden_messages_own_select" on public.hidden_messages
  for select using (auth.uid() = user_id);

-- ---------- read_state ----------
drop policy if exists "Ecriture suivi lecture" on public.read_state;
create policy "Ecriture suivi lecture" on public.read_state
  for insert with check (auth.uid() = user_id);

drop policy if exists "Lecture suivi lecture" on public.read_state;
create policy "Lecture suivi lecture" on public.read_state
  for select using (auth.uid() = user_id);

drop policy if exists "Mise a jour suivi lecture" on public.read_state;
create policy "Mise a jour suivi lecture" on public.read_state
  for update using (auth.uid() = user_id);

-- ---------- dm_conversations ----------
drop policy if exists "dm_conversations_participants_only" on public.dm_conversations;
create policy "dm_conversations_participants_only" on public.dm_conversations
  for select using (auth.uid() = user_one or auth.uid() = user_two);

-- ---------- dm_messages ----------
drop policy if exists "dm_messages_insert_participants" on public.dm_messages;
create policy "dm_messages_insert_participants" on public.dm_messages
  for insert with check (
    sender_id = auth.uid() and exists (
      select 1 from dm_conversations c
      where c.id = dm_messages.conversation_id
        and (c.user_one = auth.uid() or c.user_two = auth.uid())
    )
  );

drop policy if exists "dm_messages_select_participants" on public.dm_messages;
create policy "dm_messages_select_participants" on public.dm_messages
  for select using (
    exists (
      select 1 from dm_conversations c
      where c.id = dm_messages.conversation_id
        and (c.user_one = auth.uid() or c.user_two = auth.uid())
    )
  );

drop policy if exists "dm_messages_update_own_or_admin" on public.dm_messages;
create policy "dm_messages_update_own_or_admin" on public.dm_messages
  for update using (sender_id = auth.uid() or is_admin())
  with check (sender_id = auth.uid() or is_admin());

-- Colonnes verrouillées : seules content/edited_at/is_deleted/attachment_url
-- sont modifiables par un utilisateur normal (delivered_at/read_at ne
-- passent QUE par les fonctions RPC mark_conversation_delivered/read,
-- exécutées en SECURITY DEFINER).
revoke update on public.dm_messages from anon, authenticated;
grant update (content, edited_at, is_deleted, attachment_url) on public.dm_messages to authenticated;

revoke execute on function public.mark_conversation_delivered(uuid) from public;
grant execute on function public.mark_conversation_delivered(uuid) to authenticated;
revoke execute on function public.mark_conversation_read(uuid) from public;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- ---------- dm_hidden_messages ----------
drop policy if exists "dm_hidden_messages_own_insert" on public.dm_hidden_messages;
create policy "dm_hidden_messages_own_insert" on public.dm_hidden_messages
  for insert with check (auth.uid() = user_id);

drop policy if exists "dm_hidden_messages_own_select" on public.dm_hidden_messages;
create policy "dm_hidden_messages_own_select" on public.dm_hidden_messages
  for select using (auth.uid() = user_id);

-- ---------- dm_read_state ----------
drop policy if exists "dm_read_state_own_select" on public.dm_read_state;
create policy "dm_read_state_own_select" on public.dm_read_state
  for select using (auth.uid() = user_id);

drop policy if exists "dm_read_state_own_upsert" on public.dm_read_state;
create policy "dm_read_state_own_upsert" on public.dm_read_state
  for insert with check (auth.uid() = user_id);

drop policy if exists "dm_read_state_own_update" on public.dm_read_state;
create policy "dm_read_state_own_update" on public.dm_read_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- formations ----------
-- Doublons anciens/nouveaux conservés fidèlement (lecture publique en double).
drop policy if exists "Lecture formations" on public.formations;
create policy "Lecture formations" on public.formations
  for select using (true);

drop policy if exists "formations_public_read" on public.formations;
create policy "formations_public_read" on public.formations
  for select using (true);

drop policy if exists "formations_admin_insert" on public.formations;
create policy "formations_admin_insert" on public.formations
  for insert with check (is_admin());

drop policy if exists "formations_admin_update" on public.formations;
create policy "formations_admin_update" on public.formations
  for update using (is_admin()) with check (is_admin());

drop policy if exists "formations_admin_delete" on public.formations;
create policy "formations_admin_delete" on public.formations
  for delete using (is_admin());

-- ---------- formation_modules ----------
drop policy if exists "Lecture publique modules" on public.formation_modules;
create policy "Lecture publique modules" on public.formation_modules
  for select using (true);

-- ---------- formation_lessons ----------
drop policy if exists "Lecture publique leçons" on public.formation_lessons;
create policy "Lecture publique leçons" on public.formation_lessons
  for select using (true);

-- ---------- course_progress ----------
drop policy if exists "Progression : lecture propre" on public.course_progress;
create policy "Progression : lecture propre" on public.course_progress
  for select using (auth.uid() = user_id);

drop policy if exists "Progression : écriture propre" on public.course_progress;
create policy "Progression : écriture propre" on public.course_progress
  for insert with check (
    auth.uid() = user_id and exists (
      select 1 from formation_lessons fl
      join formation_modules fm on fm.id = fl.module_id
      where fl.id = course_progress.lesson_id
        and (
          fl.is_preview or exists (
            select 1 from purchases p
            where p.user_id = auth.uid()
              and p.course_id = fm.formation_id
              and p.product_type = 'formation'
              and p.status = 'paid'
          )
        )
    )
  );

drop policy if exists "Progression : mise à jour propre" on public.course_progress;
create policy "Progression : mise à jour propre" on public.course_progress
  for update using (
    auth.uid() = user_id and exists (
      select 1 from formation_lessons fl
      join formation_modules fm on fm.id = fl.module_id
      where fl.id = course_progress.lesson_id
        and (
          fl.is_preview or exists (
            select 1 from purchases p
            where p.user_id = auth.uid()
              and p.course_id = fm.formation_id
              and p.product_type = 'formation'
              and p.status = 'paid'
          )
        )
    )
  )
  with check (
    auth.uid() = user_id and exists (
      select 1 from formation_lessons fl
      join formation_modules fm on fm.id = fl.module_id
      where fl.id = course_progress.lesson_id
        and (
          fl.is_preview or exists (
            select 1 from purchases p
            where p.user_id = auth.uid()
              and p.course_id = fm.formation_id
              and p.product_type = 'formation'
              and p.status = 'paid'
          )
        )
    )
  );

-- ---------- digital_products ----------
drop policy if exists "Lecture produits disponibles" on public.digital_products;
create policy "Lecture produits disponibles" on public.digital_products
  for select using (disponible = true);

drop policy if exists "digital_products_admin_insert" on public.digital_products;
create policy "digital_products_admin_insert" on public.digital_products
  for insert with check (is_admin());

drop policy if exists "digital_products_admin_update" on public.digital_products;
create policy "digital_products_admin_update" on public.digital_products
  for update using (is_admin()) with check (is_admin());

drop policy if exists "digital_products_admin_delete" on public.digital_products;
create policy "digital_products_admin_delete" on public.digital_products
  for delete using (is_admin());

-- ---------- purchases ----------
drop policy if exists "Lecture achats personnels" on public.purchases;
create policy "Lecture achats personnels" on public.purchases
  for select using (auth.uid() = user_id);
-- Note : insertions/mises à jour de purchases faites uniquement via
-- les fonctions serverless (clé service_role), qui contournent la RLS.

-- ---------- share_pending / share_target_rate_limit ----------
-- Aucune policy définie volontairement sur ces deux tables : seule la
-- clé service_role (utilisée exclusivement par les routes /api/share-*
-- et /api/share-target.js) peut y accéder. Aucun accès client, anonyme
-- ou authentifié.


-- =========================================================
-- 5. REALTIME
-- =========================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dm_messages'
  ) then
    alter publication supabase_realtime add table public.dm_messages;
  end if;
end $$;
