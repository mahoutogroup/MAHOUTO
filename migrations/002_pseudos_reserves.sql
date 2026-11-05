-- ============================================================
-- MAHOUTO+ — 002 : pseudos réservés et pseudos en forme d'e-mail
-- ============================================================
--
-- Problème : le pseudo (public.profiles.username) et le nom affiché d'un
-- message de salon (public.messages.username, texte libre) peuvent être
-- n'importe quoi : « MAJESTÉ AI », « Admin », « Support »... ou une adresse
-- e-mail.
--
-- Ce script, côté base (il n'existe aucune route serveur pour écrire un
-- profil : les pages écrivent directement dans Supabase) :
--   1. public.reserved_usernames : liste des noms réservés, sous forme
--      normalisée. Pour en ajouter un sans nouvelle migration :
--        insert into public.reserved_usernames (normalized, label)
--        values ((public.username_variants('Mon Nom'))[1], 'Mon Nom');
--   2. public.username_variants(texte) : normalisation insensible à la
--      casse, aux accents, aux espaces, aux tirets, à la ponctuation, aux
--      chiffres de substitution (4=a 3=e 0=o 5=s 7=t, 1=i ou l), aux
--      symboles (@=a $=s !=i |=i ou l) et aux lettres cyrilliques ou
--      grecques qui ressemblent à des lettres latines.
--      Exemples refusés : « M4JESTE AI », « Majesté-AI », « m.a.j.e.s.t.é a i »,
--      « MAHOUTO+ », « Mahouto Sch00l ».
--   3. public.is_reserved_username(texte) : vrai si le nom normalisé est
--      EXACTEMENT un nom de la liste. « Mahouto Abdallah » reste autorisé
--      (nom du fondateur), et « Majesté AI Officiel » aussi : la règle ne
--      porte que sur l'égalité exacte (voir la description de la PR).
--   4. public.reserved_username_exempt_accounts : comptes officiels exemptés
--      PAR IDENTIFIANT (9 comptes de départ). Pour en ajouter un :
--        insert into public.reserved_username_exempt_accounts (user_id, note)
--        values ('<uuid>', 'compte officiel');
--   5. Deux déclencheurs qui refusent avec le message « PSEUDO_RESERVE » ou
--      « PSEUDO_EMAIL » :
--        - profiles : à l'INSERTION et quand le pseudo CHANGE (jamais sur une
--          autre mise à jour) ;
--        - messages : à l'insertion et quand le nom affiché change, sauf si
--          c'est le pseudo actuel de l'auteur (un compte existant qui porte
--          déjà un nom réservé ou une adresse e-mail n'est pas bloqué : voir
--          les requêtes de repérage dans 000_diagnostic_lecture_seule.sql,
--          rien n'est modifié automatiquement).
--      Exemptés du contrôle des NOMS RÉSERVÉS : les rôles founder, admin,
--      super_admin (public.is_admin()), les 9 comptes par identifiant, et les
--      contextes sans utilisateur (SQL Editor, clé service_role : routes
--      serveur comme api/share-finalize.js).
--      Le refus d'un pseudo en FORME D'ADRESSE E-MAIL (PSEUDO_EMAIL) ne
--      connaît d'exemption que le SQL Editor et la clé service_role :
--      l'e-mail ne doit jamais servir de pseudo, pour personne.
--
-- Aucune donnée existante n'est modifiée (ni profil, ni message).
--
-- Limites connues : les caractères visuellement proches non listés (autres
-- alphabets, caractères invisibles) ne sont pas tous couverts ; un nom qui
-- CONTIENT un nom réservé avec d'autres mots n'est pas refusé.
--
-- ⚠️ À EXÉCUTER MANUELLEMENT (SQL Editor Supabase), APRÈS le déploiement
-- du code de la PR (qui affiche un message clair quand un pseudo est
-- refusé et ne met plus l'e-mail comme pseudo par défaut). Sans ce code,
-- un pseudo refusé ferait échouer l'écriture sans explication à l'écran.
-- Retour arrière : migrations/rollback/002_pseudos_reserves.sql
-- ------------------------------------------------------------

begin;

create table if not exists public.reserved_usernames (
  normalized text primary key check (normalized ~ '^[a-z0-9]+$'),
  label text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.reserved_username_exempt_accounts (
  user_id uuid primary key,
  note text,
  created_at timestamptz not null default now()
);

-- Tables internes : RLS activée, aucune politique, aucun droit pour les
-- clients. Seules les fonctions SECURITY DEFINER ci-dessous et
-- l'administrateur de la base (SQL Editor) y accèdent.
alter table public.reserved_usernames enable row level security;
alter table public.reserved_username_exempt_accounts enable row level security;
revoke all on table public.reserved_usernames from public, anon, authenticated;
revoke all on table public.reserved_username_exempt_accounts from public, anon, authenticated;

create or replace function public.username_variants(p text)
returns text[]
language sql
immutable
parallel safe
as $$
  with base as (
    select translate(
             replace(replace(lower(coalesce(p, '')), 'œ', 'oe'), 'æ', 'ae'),
             'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŸавекмнорстухіјѕАВЕКМНОРСТУХІЈЅαβεικμνορτυχΑΒΕΙΚΜΝΟΡΤΥΧ@$!|',
             'aaaaaaceeeeiiiinooooouuuuyyaaaaaaceeeeiiiinooooouuuuyyabekmhopctyxijsabekmhopctyxijsabeikmvoptuxabeikmvoptuxas11'
           ) as s
  )
  select array[
    regexp_replace(translate(s, '430571', 'aeosti'), '[^a-z0-9]', '', 'g'),
    regexp_replace(translate(s, '430571', 'aeostl'), '[^a-z0-9]', '', 'g')
  ]
  from base
$$;

create or replace function public.is_reserved_username(p text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.reserved_usernames r
    where r.normalized = any (public.username_variants(p))
  );
$$;

-- Forme d'adresse e-mail : même test que MahoutoPseudo.looksLikeEmail (pseudo.js).
create or replace function public.looks_like_email(p text)
returns boolean
language sql
immutable
parallel safe
as $$
  select btrim(coalesce(p, '')) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
$$;

revoke execute on function public.is_reserved_username(text) from public, anon;
grant execute on function public.is_reserved_username(text) to authenticated, service_role;

insert into public.reserved_usernames (normalized, label)
select (public.username_variants(label))[1], label
from (values
  ('MAJESTÉ AI'), ('MAJESTE AI'), ('MAHOUTO'), ('MAHOUTO+'), ('MAHOUTO SCHOOL'),
  ('MAJESTÉ PRESSE'), ('Admin'), ('Support'), ('Fondateur'), ('Annonces')
) as v(label)
on conflict (normalized) do nothing;

insert into public.reserved_username_exempt_accounts (user_id, note)
values
  ('0b3b3de9-b835-40ec-b076-22fdc3c4ab02'::uuid, 'compte officiel'),
  ('8894a9f5-c2e4-45c3-a927-e36f64a104f7'::uuid, 'compte officiel'),
  ('0a68d262-5615-4819-8d48-e6522f6a0e6f'::uuid, 'compte officiel'),
  ('5b096879-b856-42f5-9952-790f09abbf6f'::uuid, 'compte officiel'),
  ('6706610f-5a79-411b-a24d-07481cbd0ce7'::uuid, 'compte officiel'),
  ('9e999155-e1c9-4286-adc4-9f4c97c95c3b'::uuid, 'compte officiel'),
  ('1af183aa-45ef-4a4d-afa9-6b77ca8b04a2'::uuid, 'compte officiel'),
  ('149965bd-1565-40ce-bc6d-07154f43c256'::uuid, 'compte officiel'),
  ('ae75d336-3653-487f-bec2-5ee793e0fafa'::uuid, 'compte officiel')
on conflict (user_id) do nothing;

create or replace function public.enforce_reserved_username_profiles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Contrôle seulement à l'insertion, ou quand le pseudo change.
  if tg_op = 'UPDATE' and new.username is not distinct from old.username then
    return new;
  end if;

  -- SQL Editor, clé service_role : pas d'utilisateur, contexte de confiance.
  if auth.uid() is null then
    return new;
  end if;

  -- Jamais d'adresse e-mail comme pseudo (aucune exemption côté utilisateur).
  if public.looks_like_email(new.username) then
    raise exception 'PSEUDO_EMAIL: le pseudo ne peut pas etre une adresse e-mail'
      using errcode = '23514', hint = 'email_as_username';
  end if;

  -- Exemptés des noms réservés : founder / admin / super_admin, comptes officiels par identifiant.
  if public.is_admin()
     or exists (select 1 from public.reserved_username_exempt_accounts e where e.user_id = auth.uid()) then
    return new;
  end if;

  if public.is_reserved_username(new.username) then
    raise exception 'PSEUDO_RESERVE: ce pseudo est reserve'
      using errcode = '23514', hint = 'reserved_username';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_reserved_username_profiles on public.profiles;
create trigger trg_reserved_username_profiles
  before insert or update of username on public.profiles
  for each row execute function public.enforce_reserved_username_profiles();

create or replace function public.enforce_reserved_username_messages()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  own_name boolean;
begin
  -- Contrôle seulement à l'insertion, ou quand le nom affiché change.
  if tg_op = 'UPDATE' and new.username is not distinct from old.username then
    return new;
  end if;

  if auth.uid() is null then
    return new;
  end if;

  -- Compte existant : son pseudo actuel reste utilisable, même réservé ou en forme d'e-mail.
  select exists (
    select 1 from public.profiles p
    where p.id = new.user_id and p.username = new.username
  ) into own_name;

  if public.looks_like_email(new.username) and not own_name then
    raise exception 'PSEUDO_EMAIL: le nom affiche ne peut pas etre une adresse e-mail'
      using errcode = '23514', hint = 'email_as_username';
  end if;

  if public.is_admin()
     or exists (select 1 from public.reserved_username_exempt_accounts e where e.user_id = auth.uid()) then
    return new;
  end if;

  if public.is_reserved_username(new.username) and not own_name then
    raise exception 'PSEUDO_RESERVE: ce nom affiche est reserve'
      using errcode = '23514', hint = 'reserved_username';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_reserved_username_messages on public.messages;
create trigger trg_reserved_username_messages
  before insert or update of username on public.messages
  for each row execute function public.enforce_reserved_username_messages();

commit;
