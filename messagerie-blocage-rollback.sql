-- =========================================================
-- MAHOUTO+ - Messagerie privee : RETOUR ARRIERE de messagerie-blocage.sql
--
-- BLOC 1 : RETRAIT IMMEDIAT du declencheur sur dm_messages (une seule
-- instruction, SANS confirmation, sans perte de donnees). Les messages
-- repartent aussitot dans les deux sens. A lancer EN PREMIER en cas de souci.
-- Les blocages enregistres sont gardes tant que le BLOC 4 n est pas execute.
-- Les conversations et les messages ne sont JAMAIS touches.
--
-- Retour complet, dans l ordre : 1 declencheur - 2 profil_public_ecrire
-- (version SANS blocage) - 3 fonctions - 4 table (confirmation, les blocages
-- sont PERDUS). Chaque bloc se relance sans erreur. Deployez d abord le code
-- precedent (sans la PR) avant les blocs 3 et 4.
-- =========================================================


-- BLOC 1 - RETRAIT IMMEDIAT du declencheur (sans confirmation)
drop trigger if exists dm_messages_blocage on public.dm_messages;


-- BLOC 2 - profil_public_ecrire : version SANS le controle du blocage
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


-- BLOC 3 - Fonctions (le declencheur doit etre retire : BLOC 1)
drop function if exists public.dm_messages_controle_blocage();

drop function if exists public.dm_mes_blocages();

drop function if exists public.dm_debloquer(uuid);

drop function if exists public.dm_bloquer(uuid);

drop function if exists public.dm_bloque_entre(uuid, uuid);


-- BLOC 4 - Table des blocages (confirmation requise : les blocages sont PERDUS)
do $$
declare
  confirmation constant text := 'NON';
  n_blocages integer := 0;
begin
  if to_regclass('public.dm_blocages') is not null then
    execute 'select count(*) from public.dm_blocages' into n_blocages;
  end if;
  raise warning 'ATTENTION : % blocage(s) seront PERDUS.', n_blocages;
  if confirmation <> 'OUI' then
    raise exception 'Retour arriere NON confirme. Editez confirmation := OUI.';
  end if;
  drop table if exists public.dm_blocages;
end $$;
