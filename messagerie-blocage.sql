-- =========================================================
-- MAHOUTO+ - Messagerie privee : BLOQUER un membre
--
-- Un membre peut en bloquer un autre. Le blocage vaut dans les DEUX sens pour
-- l envoi de messages : ni le bloqueur ni la personne bloquee ne peuvent
-- ecrire dans la conversation. L historique reste lisible par les deux.
-- La personne bloquee ne peut pas savoir qu elle l est : elle recoit
-- seulement une erreur neutre a l envoi (la meme dans les deux sens), et la
-- page publique du bloqueur lui repond comme si les messages etaient
-- desactives (code desactive). Aucune fonction ne renvoie jamais qui a bloque
-- qui, sauf dm_mes_blocages qui ne liste QUE les membres que J ai bloques.
--
-- ADDITIF, SAUF le BLOC 7 (profil_public_ecrire recreee avec le controle du
-- blocage, tous ses autres codes et regles sont conservees) et le BLOC 9 (le
-- declencheur sur dm_messages, POINT SENSIBLE). Aucune politique RLS des tables
-- dm_* n est modifiee. Aucune conversation ni aucun message existant n est
-- supprime ni modifie. get_or_create_dm_conversation n est pas touchee.
--
-- A EXECUTER A LA MAIN dans Supabase (SQL Editor), d abord sur un projet de
-- TEST, BLOC PAR BLOC : copier un bloc, l executer, passer au suivant. Chaque
-- bloc est court, autonome et se relance sans erreur. Aucun commentaire ne
-- contient d apostrophe et tous les commentaires sont AVANT les instructions.
-- Prerequis : profils-publics-ecrire.sql deja execute (profil_public_ecrire).
-- A executer AVANT la fusion de la PR.
--
-- BLOCS (dans l ordre) :
--   BLOC 1 - Verification des prerequis. Ne modifie rien.
--   BLOC 2 - Table dm_blocages : RLS, lecture de SES blocages seulement.
--   BLOC 3 - dm_bloque_entre (interne, aucun droit client).
--   BLOC 4 - dm_bloquer.
--   BLOC 5 - dm_debloquer.
--   BLOC 6 - dm_mes_blocages (liste de MES blocages).
--   BLOC 7 - profil_public_ecrire (ajoute le controle du blocage).
--   BLOC 8 - Fonction du declencheur (ne bloque encore rien).
--   BLOC 9 - ACTIVATION du declencheur sur dm_messages (en dernier).
--
-- RETRAIT IMMEDIAT du declencheur si quelque chose se passe mal : BLOC 1 de
-- messagerie-blocage-rollback.sql (une seule instruction, sans confirmation) :
--   drop trigger if exists dm_messages_blocage on public.dm_messages;
-- Les messages repartent aussitot. Les blocages enregistres sont gardes.
--
-- CODES : dm_bloquer = ok, deja, soi_meme, inconnu, non_connecte.
-- dm_debloquer = ok, absent, non_connecte.
-- =========================================================


-- BLOC 1 - Verification des prerequis (ne modifie rien)
do $$
begin
  if to_regclass('public.dm_conversations') is null
     or to_regclass('public.dm_messages') is null then
    raise exception 'Tables dm_conversations ou dm_messages introuvables';
  end if;
  if to_regclass('public.profiles') is null then
    raise exception 'Table profiles introuvable';
  end if;
  if to_regprocedure('public.profil_public_ecrire(text)') is null then
    raise exception 'profil_public_ecrire introuvable : profils-publics-ecrire.sql';
  end if;
  if to_regprocedure('public.profils_publics_adresse_valide(text)') is null
     or to_regprocedure('public.profils_publics_ouvert()') is null
     or to_regprocedure('public.is_admin()') is null then
    raise exception 'Fonctions des profils publics introuvables';
  end if;
end $$;


-- BLOC 2 - Table des blocages : un membre ne lit que SES lignes, aucune ecriture directe
create table if not exists public.dm_blocages (
  bloqueur_id uuid not null references auth.users(id) on delete cascade,
  bloque_id uuid not null references auth.users(id) on delete cascade,
  cree_le timestamptz not null default now(),
  primary key (bloqueur_id, bloque_id),
  constraint dm_blocages_pas_soi_meme check (bloqueur_id <> bloque_id)
);

create index if not exists dm_blocages_bloque_idx on public.dm_blocages (bloque_id);

alter table public.dm_blocages enable row level security;

drop policy if exists dm_blocages_lecture_mes_blocages on public.dm_blocages;

create policy dm_blocages_lecture_mes_blocages on public.dm_blocages
  for select to authenticated
  using (bloqueur_id = auth.uid());

revoke all on public.dm_blocages from public;

revoke all on public.dm_blocages from anon, authenticated;

grant select (bloque_id, cree_le) on public.dm_blocages to authenticated;


-- BLOC 3 - Fonction INTERNE : un blocage existe-t-il dans un sens ou dans l autre ?
create or replace function public.dm_bloque_entre(a uuid, b uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path = public, pg_temp
as $$
  select exists (select 1 from public.dm_blocages x
                  where (x.bloqueur_id = a and x.bloque_id = b)
                     or (x.bloqueur_id = b and x.bloque_id = a));
$$;

revoke all on function public.dm_bloque_entre(uuid, uuid) from public, anon, authenticated;


-- BLOC 4 - Bloquer un membre
create or replace function public.dm_bloquer(p_membre uuid)
 returns text
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_claims jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  v_n integer;
begin
  if v_uid is null
     or coalesce((v_claims ->> 'is_anonymous')::boolean, false)
     or coalesce(v_claims -> 'app_metadata' ->> 'provider', '') = 'anonymous' then
    return 'non_connecte';
  end if;
  if p_membre is null then
    return 'inconnu';
  end if;
  if p_membre = v_uid then
    return 'soi_meme';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_membre) then
    return 'inconnu';
  end if;
  insert into public.dm_blocages (bloqueur_id, bloque_id)
  values (v_uid, p_membre)
  on conflict do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return 'deja';
  end if;
  return 'ok';
end;
$$;

revoke all on function public.dm_bloquer(uuid) from public, anon;

grant execute on function public.dm_bloquer(uuid) to authenticated;


-- BLOC 5 - Debloquer un membre
create or replace function public.dm_debloquer(p_membre uuid)
 returns text
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_claims jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  v_n integer;
begin
  if v_uid is null
     or coalesce((v_claims ->> 'is_anonymous')::boolean, false)
     or coalesce(v_claims -> 'app_metadata' ->> 'provider', '') = 'anonymous' then
    return 'non_connecte';
  end if;
  delete from public.dm_blocages x
   where x.bloqueur_id = v_uid and x.bloque_id = p_membre;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return 'absent';
  end if;
  return 'ok';
end;
$$;

revoke all on function public.dm_debloquer(uuid) from public, anon;

grant execute on function public.dm_debloquer(uuid) to authenticated;


-- BLOC 6 - Liste des membres que J ai bloques (jamais l inverse)
create or replace function public.dm_mes_blocages()
 returns table (membre_id uuid, nom text, cree_le timestamptz)
 language sql
 stable
 security definer
 set search_path = public, pg_temp
as $$
  select b.bloque_id, p.username, b.cree_le
    from public.dm_blocages b
    left join public.profiles p on p.id = b.bloque_id
   where b.bloqueur_id = auth.uid()
   order by b.cree_le desc;
$$;

revoke all on function public.dm_mes_blocages() from public, anon;

grant execute on function public.dm_mes_blocages() to authenticated;


-- BLOC 7 - profil_public_ecrire : identique a la version actuelle, plus le controle du blocage
-- (un blocage dans un sens ou dans l autre repond desactive, comme messages fermes)
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
  if public.dm_bloque_entre(v_uid, v_page.user_id) then
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


-- BLOC 8 - Fonction du declencheur : lit seulement, ne bloque rien tant que le BLOC 9 n est pas execute
-- Sans session (auth.uid nul : service role, SQL Editor) elle ne fait rien.
-- Une seule erreur, neutre, identique dans les deux sens (ne dit pas qui a bloque).
create or replace function public.dm_messages_controle_blocage()
 returns trigger
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $$
declare
  v_conv record;
  v_autre uuid;
begin
  if auth.uid() is null then
    return new;
  end if;
  select c.user_one, c.user_two into v_conv
    from public.dm_conversations c
   where c.id = new.conversation_id;
  if not found then
    return new;
  end if;
  if v_conv.user_one = new.sender_id then
    v_autre := v_conv.user_two;
  elsif v_conv.user_two = new.sender_id then
    v_autre := v_conv.user_one;
  else
    return new;
  end if;
  if public.dm_bloque_entre(new.sender_id, v_autre) then
    raise exception 'Impossible d envoyer ce message' using errcode = 'MB001';
  end if;
  return new;
end;
$$;

revoke all on function public.dm_messages_controle_blocage() from public, anon, authenticated;


-- BLOC 9 - ACTIVATION du declencheur sur dm_messages (a executer EN DERNIER)
-- Retrait immediat : drop trigger if exists dm_messages_blocage on public.dm_messages;
drop trigger if exists dm_messages_blocage on public.dm_messages;

create trigger dm_messages_blocage
  before insert on public.dm_messages
  for each row execute function public.dm_messages_controle_blocage();
