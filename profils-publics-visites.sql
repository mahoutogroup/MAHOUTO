-- =========================================================
-- MAHOUTO+ - Profil public : VISITES de sa page (PR 3 sur 3)
--
-- Le compteur de visites reutilise l existant : analytics.js enregistre UNE ligne
-- par visiteur et par 30 minutes dans page_views (sans cookie, sans identite).
-- Pour une page publique, la ligne porte page_type = other, path = /m.html et
-- item_id = l adresse de la page (aucun changement de la table page_views).
--
-- Ce fichier ajoute UNE fonction : profil_public_visites_mien(p_jours).
-- Elle renvoie au membre connecte, pour SA page seulement, le total par jour et
-- la repartition par source (qr, lien, autre). Aucun identifiant de visiteur,
-- aucun appareil, aucune heure precise. Le membre ne lit jamais page_views.
--
-- A EXECUTER A LA MAIN dans Supabase (SQL Editor), d abord sur un projet de TEST,
-- BLOC PAR BLOC : copier un bloc, l executer, passer au suivant. Chaque bloc est
-- court, autonome et se relance sans erreur. Aucun commentaire ne contient
-- d apostrophe et tous les commentaires sont AVANT les instructions.
-- Prerequis : profils-publics.sql et page-views-setup.sql deja executes.
-- A executer AVANT la fusion de la PR.
--
-- BLOCS (dans l ordre) :
--   BLOC 1 - Verification des prerequis. Ne modifie rien.
--   BLOC 2 - Fonction profil_public_visites_mien (authenticated seulement).
--
-- REPARTITION PAR SOURCE
--   qr    : source = qr (le QR code ouvre la page avec ?src=qr)
--   lien  : source = direct, whatsapp, facebook, instagram ou tiktok
--   autre : toute autre source (moteur de recherche, autre site, inconnue)
--
-- Jours : fuseau Africa/Porto-Novo (comme les statistiques admin), p_jours borne
-- entre 1 et 90, aujourd hui compris. Les jours sans visite valent zero.
--
-- Retour arriere : profils-publics-visites-rollback.sql.
-- Verification : profils-publics-visites-verification.sql.
-- =========================================================


-- BLOC 1 - Verification des prerequis (ne modifie rien)
do $$
begin
  if to_regclass('public.page_views') is null then
    raise exception 'Table page_views introuvable : executez d abord page-views-setup.sql';
  end if;
  if to_regclass('public.profils_publics') is null then
    raise exception 'Table profils_publics introuvable : executez d abord profils-publics.sql';
  end if;
end $$;


-- BLOC 2 - Visites de MA page : l adresse est retrouvee par auth.uid(), jamais passee en parametre
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
