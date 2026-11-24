-- =========================================================
-- MAHOUTO+ - Profil public : RETOUR ARRIERE de profils-publics-alias.sql
--
-- BLOC 1 : RETRAIT IMMEDIAT du declencheur sur profils_publics (une seule instruction, SANS
-- confirmation, sans perte de donnees) : les adresses redeviennent exactement comme avant. A lancer
-- EN PREMIER en cas de souci. Les alias enregistres sont gardes tant que le BLOC 4 n est pas
-- execute. Les pages ne sont JAMAIS touchees.
--
-- Retour complet, dans l ordre : 1 declencheur - 2 profil_public_adresse_disponible (version SANS
-- alias) - 3 fonctions - 4 table (confirmation, les alias sont PERDUS). Chaque bloc se relance sans
-- erreur. Deployez d abord le code precedent (sans la PR) avant les blocs 3 et 4.
-- =========================================================


-- BLOC 1 - RETRAIT IMMEDIAT du declencheur (sans confirmation)
drop trigger if exists profils_publics_alias_garde_trg on public.profils_publics;


-- BLOC 2 - profil_public_adresse_disponible : version SANS le controle des alias
create or replace function public.profil_public_adresse_disponible(p_adresse text)
 returns text
 language plpgsql
 stable
 security definer
 set search_path = public, pg_temp
as $$
declare
  v record;
begin
  if p_adresse is null or p_adresse !~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$' then
    return 'invalide';
  end if;
  select p.user_id into v from public.profils_publics p where p.adresse = p_adresse;
  if found then
    if v.user_id = auth.uid() then
      return 'libre';
    end if;
    return 'prise';
  end if;
  if public.profils_publics_adresse_reservee(p_adresse) then
    return 'reservee';
  end if;
  return 'libre';
end;
$$;

revoke all on function public.profil_public_adresse_disponible(text) from public, anon;

grant execute on function public.profil_public_adresse_disponible(text) to authenticated;


-- BLOC 3 - Fonctions (le declencheur doit etre retire : BLOC 1)
drop function if exists public.profil_public_alias_resoudre(text);

drop function if exists public.profils_publics_admin_alias_lister();

drop function if exists public.profils_publics_admin_alias_retirer(text);

drop function if exists public.profils_publics_admin_alias_ajouter(text, text);

drop function if exists public.profils_publics_alias_garde();

drop function if exists public.profils_publics_alias_pris(text);


-- BLOC 4 - Table des alias (confirmation requise : les alias sont PERDUS)
do $$
declare
  confirmation constant text := 'NON';
  n_alias integer := 0;
begin
  if to_regclass('public.profils_publics_alias') is not null then
    execute 'select count(*) from public.profils_publics_alias' into n_alias;
  end if;
  raise warning 'ATTENTION : % alias seront PERDUS.', n_alias;
  if confirmation <> 'OUI' then
    raise exception 'Retour arriere NON confirme. Editez confirmation := OUI.';
  end if;
  drop table if exists public.profils_publics_alias;
end $$;
