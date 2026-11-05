-- ============================================================
-- MAHOUTO+ — 002 : pseudos réservés
-- ============================================================
--
-- Problème : le pseudo (public.profiles.username) et le nom affiché d'un
-- message de salon (public.messages.username, texte libre) peuvent être
-- n'importe quoi : n'importe qui peut s'appeler « MAJESTÉ AI », « Admin »,
-- « Support »...
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
--   4. Deux déclencheurs qui refusent avec le message « PSEUDO_RESERVE » :
--        - profiles : à l'insertion et quand le pseudo CHANGE ;
--        - messages : à l'insertion et quand le nom affiché change, sauf si
--          c'est le pseudo actuel de l'auteur (un compte existant qui porte
--          déjà un nom réservé n'est pas bloqué : voir la requête de
--          repérage dans 000_diagnostic_lecture_seule.sql, rien n'est
--          modifié automatiquement).
--      Sont exemptés : les admins (public.is_admin()), et les contextes
--      sans utilisateur (SQL Editor, clé service_role : routes serveur
--      comme api/share-finalize.js).
--
-- Limites connues : les caractères visuellement proches non listés (autres
-- alphabets, caractères invisibles) ne sont pas tous couverts ; un nom qui
-- CONTIENT un nom réservé avec d'autres mots n'est pas refusé.
--
-- ⚠️ À EXÉCUTER MANUELLEMENT (SQL Editor Supabase), APRÈS le déploiement
-- du code de la PR (qui affiche un message clair quand un pseudo est
-- refusé). Sans ce code, un pseudo refusé ferait échouer l'écriture sans
-- explication à l'écran. Non destructif : aucune ligne existante modifiée.
-- Retour arrière : migrations/rollback/002_pseudos_reserves.sql
-- ------------------------------------------------------------

begin;

create table if not exists public.reserved_usernames (
  normalized text primary key check (normalized ~ '^[a-z0-9]+$'),
  label text not null,
  created_at timestamptz not null default now()
);

-- Table interne : RLS activée, aucune politique, aucun droit pour les
-- clients. Seules les fonctions SECURITY DEFINER ci-dessous et
-- l'administrateur de la base (SQL Editor) y accèdent.
alter table public.reserved_usernames enable row level security;
revoke all on table public.reserved_usernames from public, anon, authenticated;

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

revoke execute on function public.is_reserved_username(text) from public, anon;
grant execute on function public.is_reserved_username(text) to authenticated, service_role;

insert into public.reserved_usernames (normalized, label)
select (public.username_variants(label))[1], label
from (values
  ('MAJESTÉ AI'), ('MAJESTE AI'), ('MAHOUTO'), ('MAHOUTO+'), ('MAHOUTO SCHOOL'),
  ('MAJESTÉ PRESSE'), ('Admin'), ('Support'), ('Fondateur'), ('Annonces')
) as v(label)
on conflict (normalized) do nothing;

create or replace function public.enforce_reserved_username_profiles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.username is not distinct from old.username then
    return new;
  end if;

  -- SQL Editor, clé service_role : pas d'utilisateur, contexte de confiance.
  if auth.uid() is null then
    return new;
  end if;

  if public.is_admin() then
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
begin
  if tg_op = 'UPDATE' and new.username is not distinct from old.username then
    return new;
  end if;

  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if public.is_reserved_username(new.username)
     and not exists (
       select 1 from public.profiles p
       where p.id = new.user_id and p.username = new.username
     ) then
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
