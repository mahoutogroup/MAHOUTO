-- =========================================================
-- MAHOUTO+ - Profil public : ECRIRE a la personne depuis sa page /m/adresse
--
-- Un membre connecte ouvre la messagerie privee EXISTANTE avec le proprietaire
-- d une page publique, sans jamais recevoir l identifiant de compte du
-- proprietaire : la fonction profil_public_ecrire renvoie seulement un code et
-- l identifiant de la conversation. Activation VOLONTAIRE par le proprietaire
-- (messages_ouverts, false par defaut).
-- Limite : 10 NOUVELLES conversations par membre et par 24 heures ouvertes
-- depuis des pages publiques ; une conversation deja existante avec ce
-- proprietaire s ouvre toujours et n est jamais comptee.
-- Aucun blocage de membre dans cette version.
--
-- ADDITIF : une colonne, une table, 3 fonctions. Aucune fonction existante
-- n est modifiee ni supprimee (profil_public_lire, profil_public_mien, etc.
-- gardent leur forme). La messagerie (dm_conversations, dm_messages,
-- get_or_create_dm_conversation et leurs politiques) n est pas touchee : les
-- fonctions ci-dessous ne dependent pas de get_or_create_dm_conversation.
--
-- A EXECUTER A LA MAIN dans Supabase (SQL Editor), d abord sur un projet de
-- TEST, BLOC PAR BLOC : copier un bloc, l executer, passer au suivant. Chaque
-- bloc est court, autonome et se relance sans erreur. Aucun commentaire ne
-- contient d apostrophe et tous les commentaires sont AVANT les instructions.
-- Prerequis : profils-publics.sql et profils-publics-signalement.sql
-- (profils_publics_adresse_valide) deja executes.
-- A executer AVANT la fusion de la PR.
--
-- BLOCS (dans l ordre) :
--   BLOC 1 - Verification des prerequis. Ne modifie rien.
--   BLOC 2 - Colonne messages_ouverts (false par defaut).
--   BLOC 3 - Droits de colonne : le proprietaire peut la renseigner.
--   BLOC 4 - Table profils_publics_ecritures (compte les nouvelles
--            conversations) : RLS, aucun droit.
--   BLOC 5 - Lecture : profil_public_messages_mien, profil_public_messages_ouverts.
--   BLOC 6 - Fonction profil_public_ecrire (membres connectes seulement).
--
-- CODES RENVOYES PAR profil_public_ecrire : ok, non_connecte, invalide, ferme,
-- introuvable, propre_page, desactive, limite.
-- Ordre des controles : non_connecte (aucune session ou compte anonyme),
-- invalide, ferme (sauf administrateur, pour les tests), introuvable,
-- propre_page, desactive, puis conversation existante (ok, sans compter) ou
-- limite (10 par 24 h) et creation.
--
-- Retour arriere : profils-publics-ecrire-rollback.sql.
-- Verification : profils-publics-ecrire-verification.sql.
-- =========================================================


-- BLOC 1 - Verification des prerequis (ne modifie rien)
do $$
begin
  if to_regclass('public.profils_publics') is null then
    raise exception 'Table profils_publics introuvable : executez d abord profils-publics.sql';
  end if;
  if to_regprocedure('public.profils_publics_adresse_valide(text)') is null then
    raise exception 'profils_publics_adresse_valide introuvable : profils-publics-signalement.sql';
  end if;
  if to_regprocedure('public.profils_publics_ouvert()') is null
     or to_regprocedure('public.is_admin()') is null then
    raise exception 'Fonctions profils_publics_ouvert ou is_admin introuvables';
  end if;
  if to_regclass('public.dm_conversations') is null then
    raise exception 'Table dm_conversations introuvable : executez d abord supabase-schema.sql';
  end if;
end $$;


-- BLOC 2 - Colonne messages_ouverts : le proprietaire doit l activer lui-meme (false par defaut)
alter table public.profils_publics
  add column if not exists messages_ouverts boolean not null default false;


-- BLOC 3 - Droits de colonne : liste complete des colonnes editables, messages_ouverts comprise
grant insert (adresse, nom_affiche, avatar_url, metier, presentation, localisation, contact_type,
              contact_valeur, publie, majeur_declare, messages_ouverts)
  on public.profils_publics to authenticated;

grant update (adresse, nom_affiche, avatar_url, metier, presentation, localisation, contact_type,
              contact_valeur, publie, majeur_declare, messages_ouverts)
  on public.profils_publics to authenticated;


-- BLOC 4 - Table des NOUVELLES conversations ouvertes depuis les pages (aucun acces)
create table if not exists public.profils_publics_ecritures (
  id bigint generated always as identity primary key,
  auteur_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  page_id uuid not null references public.profils_publics(id) on delete cascade,
  cree_le timestamptz not null default now()
);

create index if not exists ppe_auteur_idx
  on public.profils_publics_ecritures (auteur_id, cree_le desc);

alter table public.profils_publics_ecritures enable row level security;

revoke all on public.profils_publics_ecritures from public;

revoke all on public.profils_publics_ecritures from anon, authenticated;


-- BLOC 5 - Lecture : sa propre case (membres), page qui accepte les messages (tous)
create or replace function public.profil_public_messages_mien()
 returns boolean
 language sql
 stable
 security definer
 set search_path = public, pg_temp
as $$
  select coalesce((select p.messages_ouverts from public.profils_publics p
                    where p.user_id = auth.uid()), false);
$$;

revoke all on function public.profil_public_messages_mien() from public, anon;

grant execute on function public.profil_public_messages_mien() to authenticated;

create or replace function public.profil_public_messages_ouverts(p_adresse text)
 returns boolean
 language sql
 stable
 security definer
 set search_path = public, pg_temp
as $$
  select public.profils_publics_adresse_valide(p_adresse)
     and public.profils_publics_ouvert()
     and exists (select 1 from public.profils_publics p
                  where p.adresse = p_adresse and p.publie
                    and not p.suspendu and p.messages_ouverts);
$$;

revoke all on function public.profil_public_messages_ouverts(text) from public;

grant execute on function public.profil_public_messages_ouverts(text) to anon, authenticated;


-- BLOC 6 - Ecrire : ouvre ou retrouve la conversation, renvoie code et conversation_id
create or replace function public.profil_public_ecrire(p_adresse text)
 returns table (code text, conversation_id uuid)
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_claims jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  v_page record;
  v_lo uuid;
  v_hi uuid;
  v_conv uuid;
  v_n integer;
begin
  conversation_id := null;
  if v_uid is null
     or coalesce((v_claims ->> 'is_anonymous')::boolean, false)
     or coalesce(v_claims -> 'app_metadata' ->> 'provider', '') = 'anonymous' then
    code := 'non_connecte'; return next; return;
  end if;
  if not public.profils_publics_adresse_valide(p_adresse) then
    code := 'invalide'; return next; return;
  end if;
  if not public.profils_publics_ouvert() and not public.is_admin() then
    code := 'ferme'; return next; return;
  end if;
  select p.id, p.user_id, p.messages_ouverts into v_page
    from public.profils_publics p
   where p.adresse = p_adresse and p.publie and not p.suspendu;
  if not found then
    code := 'introuvable'; return next; return;
  end if;
  if v_page.user_id = v_uid then
    code := 'propre_page'; return next; return;
  end if;
  if not v_page.messages_ouverts then
    code := 'desactive'; return next; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ppe:' || v_uid::text, 0));
  v_lo := least(v_uid, v_page.user_id);
  v_hi := greatest(v_uid, v_page.user_id);
  select c.id into v_conv from public.dm_conversations c
   where c.user_one = v_lo and c.user_two = v_hi;
  if v_conv is not null then
    code := 'ok'; conversation_id := v_conv; return next; return;
  end if;
  select count(*) into v_n from public.profils_publics_ecritures e
   where e.auteur_id = v_uid and e.cree_le > now() - interval '24 hours';
  if v_n >= 10 then
    code := 'limite'; return next; return;
  end if;
  begin
    insert into public.dm_conversations (user_one, user_two) values (v_lo, v_hi)
    returning id into v_conv;
    insert into public.profils_publics_ecritures (auteur_id, page_id) values (v_uid, v_page.id);
  exception when unique_violation then
    select c.id into v_conv from public.dm_conversations c
     where c.user_one = v_lo and c.user_two = v_hi;
  end;
  if v_conv is null then
    code := 'introuvable'; return next; return;
  end if;
  code := 'ok'; conversation_id := v_conv; return next; return;
end;
$$;

revoke all on function public.profil_public_ecrire(text) from public, anon;

grant execute on function public.profil_public_ecrire(text) to authenticated;
