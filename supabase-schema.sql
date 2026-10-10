-- =========================================================
-- MAHOUTO+ — Schéma Supabase (régénéré le 19/09/2026, consolidé le
-- 27/09/2026 avec les chantiers Certificats/Attestations et Quiz)
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

alter table public.profiles add column if not exists country text;
alter table public.profiles add column if not exists full_name text; -- nom légal complet, pour les certificats/attestations (distinct du pseudo)

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

-- Salons payants (ex : "Les Sérigraphes", 2000 FCFA pour rejoindre) —
-- ajoutés le 22/09/2026. is_paid=false par défaut : tous les salons
-- existants et tous les salons créés librement par les utilisateurs
-- restent gratuits et inchangés. Seul un admin peut faire passer un
-- salon à is_paid=true (voir policies rooms_insert_own /
-- rooms_update_own_or_admin plus bas).
alter table public.rooms add column if not exists is_paid boolean not null default false;
alter table public.rooms add column if not exists price integer;

-- Photo de profil du salon (façon WhatsApp), ajoutée le 22/09/2026.
-- NULL par défaut = émoji/couleur actuels inchangés en repli. Écriture
-- déjà couverte par les policies rooms_update_own_or_admin existantes :
-- le créateur peut la définir sur SES salons gratuits, l'admin sur
-- n'importe quel salon (gratuit ou payant) — aucune policy à changer.
alter table public.rooms add column if not exists photo_url text;

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

-- Ajoutées lors du chantier "pièces jointes professionnelles" (22/09/2026),
-- déjà présentes en production — ce bloc ne fait que documenter
-- fidèlement l'état réel de la base dans ce fichier de référence.
-- attachment_public_id/attachment_resource_type : identifiant et type
-- Cloudinary, nécessaires pour générer une URL signée. attachment_access :
-- 'public' (salon gratuit) | 'authenticated' (salon payant/DM, URL
-- signée temporaire via /api/attachment). Utilisées par attachments.js,
-- api/attachment.js et api/_attachment-rules.js.
alter table public.messages add column if not exists attachment_public_id text;
alter table public.messages add column if not exists attachment_resource_type text;
alter table public.messages add column if not exists attachment_access text;
alter table public.messages add column if not exists attachment_size bigint;
alter table public.messages add column if not exists attachment_mime text;

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

-- Même ajout que sur "messages" (voir commentaire plus haut) — les DM
-- utilisent toujours attachment_access = 'authenticated' (URL signée
-- systématique, jamais publique, cf. api/_attachment-rules.js).
alter table public.dm_messages add column if not exists attachment_public_id text;
alter table public.dm_messages add column if not exists attachment_resource_type text;
alter table public.dm_messages add column if not exists attachment_access text;
alter table public.dm_messages add column if not exists attachment_size bigint;
alter table public.dm_messages add column if not exists attachment_mime text;

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
  product_type text not null default 'formation', -- 'formation' | 'digital_product' | 'salon'
  fedapay_status text,   -- statut brut renvoyé par l'API FedaPay
  paid_at timestamptz    -- horodatage de la confirmation réelle du paiement
);

alter table public.purchases
  drop constraint if exists purchases_product_type_check;
alter table public.purchases
  add constraint purchases_product_type_check
  check (product_type = any (array['formation'::text, 'digital_product'::text, 'salon'::text]));

-- ---------- Abonnements aux notifications push (24/09/2026) ----------
-- Un utilisateur peut avoir plusieurs appareils abonnés (téléphone +
-- ordinateur, par ex.) — endpoint est l'identifiant unique fourni par
-- le navigateur pour CET appareil précis.
create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_own" on public.push_subscriptions;
create policy "push_subscriptions_own" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- Note : l'envoi effectif des notifications se fait via api/push.js
-- avec la clé service_role (contourne la RLS pour lire les abonnements
-- du destinataire) — comportement identique au modèle déjà utilisé
-- pour purchases/fedapay-webhook.

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

-- ---------- Certificats / Attestations ----------
-- document_type distingue les documents auto-délivrés selon le
-- contenu de la formation (quiz présent ou non) de ceux réservés à
-- une décision manuelle (attestation_apprentissage, système de suivi
-- sur 3 ans avec dépôt de dossier CQM — jamais auto-délivrée).
create table if not exists public.certificates (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  formation_id text not null references public.formations(id) on delete cascade,
  formation_title text not null,
  status text not null default 'issued',
  issued_by text not null default 'auto',
  code text not null unique,
  document_type text not null default 'certificat',
  created_at timestamptz not null default now(),
  unique (user_id, formation_id)
);

alter table public.certificates
  drop constraint if exists certificates_status_check;
alter table public.certificates
  add constraint certificates_status_check
  check (status = any (array['issued'::text, 'revoked'::text]));

alter table public.certificates
  drop constraint if exists certificates_document_type_check;
alter table public.certificates
  add constraint certificates_document_type_check
  check (document_type in ('certificat', 'attestation', 'attestation_apprentissage'));

-- Séquences pour la numérotation officielle des attestations (jamais
-- Math.random() côté navigateur) — voir generate_certificate_code()
-- et set_certificate_code() en section FONCTIONS/TRIGGERS.
create sequence if not exists public.attestation_atf_seq;
create sequence if not exists public.attestation_afa_seq; -- réservée au futur système d'apprentissage (36 jalons)

-- ---------- Quiz (leçons de type 'quiz') ----------
-- Accès direct verrouillé pour les utilisateurs normaux (ni lecture
-- ni écriture) : les bonnes réponses vivent ici et ne doivent jamais
-- être exposées au navigateur. La lecture passe exclusivement par
-- get_quiz_questions() (jamais correct_index), la correction par
-- grade_quiz() — voir section FONCTIONS.
create table if not exists public.quiz_questions (
  id bigint generated always as identity primary key,
  lesson_id bigint not null references public.formation_lessons(id) on delete cascade,
  question text not null,
  choices jsonb not null,
  correct_index integer not null,
  ordre integer not null default 0
);

create table if not exists public.quiz_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id bigint not null references public.formation_lessons(id) on delete cascade,
  score integer not null,
  total integer not null,
  passed boolean not null,
  created_at timestamptz not null default now()
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

-- ---------- Certificats / Attestations ----------

-- Code du CERTIFICAT (comportement historique, inchangé) : format
-- MHT-XXXXXX-XXXXXXXX, sans signification séquentielle.
create or replace function public.generate_certificate_code()
returns text
language sql
as $$
  select 'MHT-'
    || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6))
    || '-'
    || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
$$;

-- Choisit le bon format de code selon document_type — jamais généré
-- côté navigateur. 'certificat' garde le format historique ci-dessus ;
-- 'attestation'/'attestation_apprentissage' utilisent une numérotation
-- officielle SÉQUENTIELLE (MHA-ATF-2026-000001 / MHA-AFA-2026-000001).
create or replace function public.set_certificate_code()
returns trigger
language plpgsql
as $$
begin
  if new.code is null then
    if new.document_type = 'attestation' then
      new.code := 'MHA-ATF-' || extract(year from now())::text || '-'
        || lpad(nextval('public.attestation_atf_seq')::text, 6, '0');
    elsif new.document_type = 'attestation_apprentissage' then
      new.code := 'MHA-AFA-' || extract(year from now())::text || '-'
        || lpad(nextval('public.attestation_afa_seq')::text, 6, '0');
    else
      new.code := public.generate_certificate_code();
    end if;
  end if;
  return new;
end;
$$;

-- Vérification publique (accessible sans connexion, via verify.html) —
-- ne renvoie JAMAIS de donnée sensible (jamais l'e-mail, jamais l'ID
-- interne, jamais qui a délivré manuellement).
create or replace function public.verify_certificate(p_code text)
returns table (
  formation_title text,
  recipient_name text,
  issued_at timestamptz,
  status text,
  code text,
  document_type text
)
language sql
security definer
set search_path = public
stable
as $$
  select c.formation_title, coalesce(p.full_name, p.username), c.created_at, c.status, c.code, c.document_type
  from public.certificates c
  join public.profiles p on p.id = c.user_id
  where c.code = p_code
  limit 1;
$$;

-- ---------- Quiz ----------

-- Renvoie les questions d'un quiz SANS jamais exposer correct_index —
-- vérifie l'accès (achat de la formation, ou leçon en aperçu gratuit)
-- avant de renvoyer quoi que ce soit.
create or replace function public.get_quiz_questions(p_lesson_id bigint)
returns table (id bigint, question text, choices jsonb, ordre integer)
language sql
security definer
set search_path = public
stable
as $$
  select q.id, q.question, q.choices, q.ordre
  from public.quiz_questions q
  join public.formation_lessons fl on fl.id = q.lesson_id
  join public.formation_modules fm on fm.id = fl.module_id
  where q.lesson_id = p_lesson_id
    and (
      fl.is_preview
      or exists (
        select 1 from public.purchases p
        where p.user_id = auth.uid()
          and p.course_id = fm.formation_id
          and p.product_type = 'formation'
          and p.status = 'paid'
      )
    )
  order by q.ordre;
$$;

-- Correction ENTIÈREMENT côté serveur : reçoit les réponses (tableau
-- d'index dans l'ordre de get_quiz_questions), calcule le score,
-- enregistre la tentative, et ne marque la leçon "terminée" dans
-- course_progress que si le seuil de 70% est atteint. Un utilisateur
-- ne peut jamais s'attribuer une réussite directement (voir policies
-- sur quiz_attempts et course_progress).
create or replace function public.grade_quiz(p_lesson_id bigint, p_answers jsonb)
returns table (score integer, total integer, passed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_score integer := 0;
  v_total integer := 0;
  v_passed boolean;
  v_question record;
  v_index integer := 0;
  v_has_access boolean;
begin
  select exists (
    select 1
    from public.formation_lessons fl
    join public.formation_modules fm on fm.id = fl.module_id
    where fl.id = p_lesson_id
      and (
        fl.is_preview
        or exists (
          select 1 from public.purchases p
          where p.user_id = auth.uid()
            and p.course_id = fm.formation_id
            and p.product_type = 'formation'
            and p.status = 'paid'
        )
      )
  ) into v_has_access;

  if not v_has_access then
    raise exception 'Accès non autorisé à cette formation.';
  end if;

  for v_question in
    select q.correct_index
    from public.quiz_questions q
    where q.lesson_id = p_lesson_id
    order by q.ordre
  loop
    v_total := v_total + 1;
    if (p_answers -> v_index)::text::integer = v_question.correct_index then
      v_score := v_score + 1;
    end if;
    v_index := v_index + 1;
  end loop;

  if v_total = 0 then
    raise exception 'Aucune question pour ce quiz.';
  end if;

  v_passed := (v_score::float / v_total::float) >= 0.7;

  insert into public.quiz_attempts (user_id, lesson_id, score, total, passed)
  values (auth.uid(), p_lesson_id, v_score, v_total, v_passed);

  if v_passed then
    insert into public.course_progress (user_id, lesson_id, completed)
    values (auth.uid(), p_lesson_id, true)
    on conflict (user_id, lesson_id) do update set completed = true, updated_at = now();
  end if;

  return query select v_score, v_total, v_passed;
end;
$$;


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

drop trigger if exists trg_set_certificate_code on public.certificates;
create trigger trg_set_certificate_code
  before insert on public.certificates
  for each row execute function public.set_certificate_code();


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
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

-- Lecture : tout utilisateur connecté peut lire n'importe quel profil
-- (nécessaire pour afficher noms/avatars dans discussions, salons, etc.).
-- Remplace les anciennes "Lecture profils" (FR) et "profiles_select_own"
-- (EN, trop restrictive et jamais réellement appliquée) — nettoyage du
-- 20/09/2026, comportement inchangé.
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated" on public.profiles
  for select using (auth.role() = 'authenticated');

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ---------- profiles.avatar_url : URL https:// uniquement ----------
-- Défense en profondeur contre l'injection HTML (le client n'insère plus avatar_url dans du HTML,
-- mais la base ne doit de toute façon accepter que de vraies URL https).
--
-- 1) (facultatif) voir ce qui serait neutralisé AVANT de lancer la suite :
--    select id, avatar_url from public.profiles
--     where avatar_url is not null and avatar_url !~* '^https://[^[:space:]"''<>]+$';

-- 2) neutralise les valeurs existantes non conformes (la photo repasse à « aucune »)
update public.profiles
   set avatar_url = null
 where avatar_url is not null
   and avatar_url !~* '^https://[^[:space:]"''<>]+$';

-- 3) contrainte : NULL ou URL https sans espace, guillemet ni chevron
alter table public.profiles drop constraint if exists profiles_avatar_url_https_check;
alter table public.profiles add constraint profiles_avatar_url_https_check
  check (avatar_url is null or avatar_url ~* '^https://[^[:space:]"''<>]+$');

-- ---------- rooms ----------
-- Anciens doublons FR ("Allow public read rooms", "Lecture salons")
-- supprimés le 20/09/2026 — rooms_public_read couvrait déjà le même
-- effet (lecture publique), comportement inchangé.
drop policy if exists "rooms_public_read" on public.rooms;
create policy "rooms_public_read" on public.rooms
  for select using (true);

-- Modifié le 22/09/2026 : un salon payant (is_paid = true) ne peut
-- être créé que par un admin. Tout le monde peut toujours créer un
-- salon gratuit comme avant.
drop policy if exists "rooms_insert_own" on public.rooms;
create policy "rooms_insert_own" on public.rooms
  for insert with check (
    created_by = auth.uid() and (is_paid = false or is_admin())
  );

drop policy if exists "rooms_delete_own_or_admin" on public.rooms;
create policy "rooms_delete_own_or_admin" on public.rooms
  for delete using (created_by = auth.uid() or is_admin());

-- Corrigé le 22/09/2026 (audit) : la clause USING gate désormais aussi
-- sur l'état actuel de la ligne. Tant qu'un salon est is_paid = true,
-- seul un admin peut le modifier (y compris pour le repasser gratuit) —
-- un créateur non-admin ne peut gérer que ses salons déjà gratuits,
-- exactement comme avant pour ce cas.
drop policy if exists "rooms_update_own_or_admin" on public.rooms;
create policy "rooms_update_own_or_admin" on public.rooms
  for update using (
    (created_by = auth.uid() and is_paid = false) or is_admin()
  )
  with check (
    (created_by = auth.uid() and is_paid = false) or is_admin()
  );

-- ---------- messages ----------
-- Modifié le 22/09/2026 : un salon payant (rooms.is_paid = true)
-- n'est lisible/écrivable que par un utilisateur ayant un achat
-- validé (purchases.status = 'paid', product_type = 'salon',
-- course_id = room_id), par le créateur du salon, ou par un admin.
-- Les salons gratuits (is_paid = false, tous ceux d'aujourd'hui)
-- restent ouverts à tous comme avant — comportement inchangé pour eux.
drop policy if exists "messages_insert_own" on public.messages;
create policy "messages_insert_own" on public.messages
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from rooms
      where rooms.id = messages.room_id
        and (
          rooms.is_paid = false
          or rooms.created_by = auth.uid()
          or is_admin()
          or exists (
            select 1 from purchases
            where purchases.user_id = auth.uid()
              and purchases.course_id = messages.room_id
              and purchases.product_type = 'salon'
              and purchases.status = 'paid'
          )
        )
    )
  );

drop policy if exists "messages_public_read" on public.messages;
create policy "messages_public_read" on public.messages
  for select using (
    exists (
      select 1 from rooms
      where rooms.id = messages.room_id
        and (
          rooms.is_paid = false
          or rooms.created_by = auth.uid()
          or is_admin()
          or exists (
            select 1 from purchases
            where purchases.user_id = auth.uid()
              and purchases.course_id = messages.room_id
              and purchases.product_type = 'salon'
              and purchases.status = 'paid'
          )
        )
    )
  );

-- Corrigé le 22/09/2026 (audit) : même règle d'accès que
-- messages_insert_own / messages_public_read pour les salons payants
-- (achat validé, créateur, ou admin) — comportement inchangé pour les
-- salons gratuits (is_paid = false). Un utilisateur ne peut toujours
-- modifier que ses propres messages (auth.uid() = user_id).
drop policy if exists "messages_update_own" on public.messages;
create policy "messages_update_own" on public.messages
  for update using (
    auth.uid() = user_id
    and exists (
      select 1 from rooms
      where rooms.id = messages.room_id
        and (
          rooms.is_paid = false
          or rooms.created_by = auth.uid()
          or is_admin()
          or exists (
            select 1 from purchases
            where purchases.user_id = auth.uid()
              and purchases.course_id = messages.room_id
              and purchases.product_type = 'salon'
              and purchases.status = 'paid'
          )
        )
    )
  )
  with check (auth.uid() = user_id);

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

-- Une leçon de type 'quiz' ne peut JAMAIS être marquée "terminée"
-- directement par le client (fl.type <> 'quiz' ci-dessous) — seule la
-- fonction grade_quiz() (SECURITY DEFINER, contourne la RLS) peut le
-- faire, et seulement après une correction réussie à 70%. Sans ça, un
-- utilisateur pourrait s'auto-valider un quiz sans jamais y répondre.
drop policy if exists "Progression : écriture propre" on public.course_progress;
create policy "Progression : écriture propre" on public.course_progress
  for insert with check (
    auth.uid() = user_id and exists (
      select 1 from formation_lessons fl
      join formation_modules fm on fm.id = fl.module_id
      where fl.id = course_progress.lesson_id
        and fl.type <> 'quiz'
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
        and fl.type <> 'quiz'
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

-- ---------- certificates ----------
alter table public.certificates enable row level security;

drop policy if exists "certificates_select" on public.certificates;
create policy "certificates_select" on public.certificates
for select to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'super_admin', 'founder')
  )
);

-- Délivrance AUTOMATIQUE : uniquement 'certificat' ou 'attestation'
-- (jamais 'attestation_apprentissage', réservée à une décision
-- manuelle), et seulement si TOUTES les leçons de la formation sont
-- réellement "completed" pour cet utilisateur — vérifié ici, jamais
-- fait confiance au client seul.
drop policy if exists "certificates_insert_auto" on public.certificates;
create policy "certificates_insert_auto" on public.certificates
for insert to authenticated
with check (
  user_id = auth.uid()
  and issued_by = 'auto'
  and status = 'issued'
  and document_type in ('certificat', 'attestation')
  and exists (
    select 1 from public.formation_lessons fl
    join public.formation_modules fm on fm.id = fl.module_id
    where fm.formation_id = certificates.formation_id
  )
  and not exists (
    select 1
    from public.formation_lessons fl
    join public.formation_modules fm on fm.id = fl.module_id
    where fm.formation_id = certificates.formation_id
    and not exists (
      select 1 from public.course_progress cp
      where cp.lesson_id = fl.id
      and cp.user_id = auth.uid()
      and cp.completed = true
    )
  )
);

-- Délivrance MANUELLE par un admin : peut délivrer n'importe quel type
-- de document à n'importe quel utilisateur (ex: formation suivie hors
-- plateforme, ou future attestation d'apprentissage sur 3 ans).
drop policy if exists "certificates_insert_admin" on public.certificates;
create policy "certificates_insert_admin" on public.certificates
for insert to authenticated
with check (
  issued_by = auth.uid()::text
  and status = 'issued'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'super_admin', 'founder')
  )
);

-- Un admin peut révoquer un document déjà délivré (status -> 'revoked').
drop policy if exists "certificates_update_admin" on public.certificates;
create policy "certificates_update_admin" on public.certificates
for update to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'super_admin', 'founder')
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'super_admin', 'founder')
  )
);

-- ---------- quiz_questions ----------
-- Accès direct verrouillé pour tout le monde SAUF les admins (gestion
-- via admin/school-content.html) — la lecture des élèves passe
-- exclusivement par get_quiz_questions(), jamais un accès direct à
-- cette table (qui contient les bonnes réponses).
alter table public.quiz_questions enable row level security;

drop policy if exists "quiz_questions_admin_all" on public.quiz_questions;
create policy "quiz_questions_admin_all" on public.quiz_questions
for all to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'super_admin', 'founder')
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'super_admin', 'founder')
  )
);

-- ---------- quiz_attempts ----------
alter table public.quiz_attempts enable row level security;

drop policy if exists "quiz_attempts_select_own" on public.quiz_attempts;
create policy "quiz_attempts_select_own" on public.quiz_attempts
for select to authenticated
using (user_id = auth.uid());

-- Volontairement AUCUNE policy d'insertion pour 'authenticated' : un
-- utilisateur ne peut jamais s'auto-attribuer une tentative réussie —
-- seule grade_quiz() (SECURITY DEFINER) peut écrire ici.

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
