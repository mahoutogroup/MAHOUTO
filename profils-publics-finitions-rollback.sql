-- =========================================================
-- MAHOUTO+ - Profil public : RETOUR ARRIERE de profils-publics-finitions.sql
--
-- Supprime le declencheur et sa fonction (maj_le ne sera plus mise a jour
-- automatiquement) et remet la fonction profil_public_visites_mien dans son
-- etat precedent (profils-publics-visites.sql : partage compte dans autre).
-- Aucune donnee n est perdue. Chaque bloc se relance sans erreur.
-- Deployez d abord le code precedent (sans la PR).
--
-- BLOCS : 1 declencheur et sa fonction - 2 fonction de visites precedente.
-- =========================================================


-- BLOC 1 - Declencheur et sa fonction
drop trigger if exists profils_publics_reglages_maj_trg on public.profils_publics_reglages;

drop function if exists public.profils_publics_reglages_maj();


-- BLOC 2 - Fonction de visites dans son etat precedent
create or replace function public.profil_public_visites_mien(p_jours integer)
 returns table (jour date, visites integer, qr integer, lien integer, autre integer)
 language plpgsql
 stable
 security definer
 set search_path = public, pg_temp
as $$
declare
  v_adresse text;
  v_jours integer := least(greatest(coalesce(p_jours, 7), 1), 90);
  v_fin date := (now() at time zone 'Africa/Porto-Novo')::date;
  v_debut date;
begin
  if auth.uid() is null then
    return;
  end if;
  select p.adresse into v_adresse from public.profils_publics p where p.user_id = auth.uid();
  if v_adresse is null then
    return;
  end if;
  v_debut := v_fin - (v_jours - 1);
  return query
    with jours as (
      select g::date as j from generate_series(v_debut, v_fin, interval '1 day') g
    ), vues as (
      select (v.created_at at time zone 'Africa/Porto-Novo')::date as j,
             case when v.source = 'qr' then 'qr'
                  when v.source in ('direct', 'whatsapp', 'facebook', 'instagram', 'tiktok')
                  then 'lien' else 'autre' end as cat
        from public.page_views v
       where v.brand = 'mahouto'
         and v.page_type = 'other'
         and v.path = '/m.html'
         and v.item_id = v_adresse
         and v.created_at >= (v_debut::timestamp at time zone 'Africa/Porto-Novo')
    )
    select d.j,
           count(w.cat)::integer,
           (count(w.cat) filter (where w.cat = 'qr'))::integer,
           (count(w.cat) filter (where w.cat = 'lien'))::integer,
           (count(w.cat) filter (where w.cat = 'autre'))::integer
      from jours d
      left join vues w on w.j = d.j
     group by d.j
     order by d.j;
end;
$$;

revoke all on function public.profil_public_visites_mien(integer) from public, anon;

grant execute on function public.profil_public_visites_mien(integer) to authenticated;
