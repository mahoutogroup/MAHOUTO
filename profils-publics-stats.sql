-- =========================================================
-- MAHOUTO+ - Profil public : STATISTIQUES pour les administrateurs (lecture seule)
--
-- Deux fonctions reservees aux administrateurs (public.is_admin()) : des chiffres simples sur les
-- pages publiques et leurs visites. LECTURE SEULE : aucune table, aucune colonne, aucune
-- politique RLS, aucun declencheur, aucune donnee modifiee. Les visites restent ANONYMES : on
-- compte des lignes de page_views, jamais de visiteur (visitor_id n est jamais lu), jamais d
-- adresse IP, jamais le contact ni user_id. Pas administrateur : aucune ligne.
--
-- A EXECUTER A LA MAIN dans Supabase (SQL Editor), d abord sur un projet de TEST, BLOC PAR BLOC :
-- copier un bloc, l executer, passer au suivant. Chaque bloc est court, autonome et se relance
-- sans erreur. Aucun commentaire ne contient d apostrophe et tous les commentaires sont AVANT les
-- instructions.
-- Prerequis (fichiers deja executes) :
--   profils-publics.sql, profils-publics-signalement.sql, profils-publics-visites.sql (page_views),
--   profils-publics-ecrire.sql (messages_ouverts), profils-publics-alias.sql.
--
-- BLOCS (dans l ordre) :
--   BLOC 1 - Verification des prerequis. Ne modifie rien.
--   BLOC 2 - profils_publics_admin_stats(p_jours) : une ligne de chiffres.
--   BLOC 3 - profils_publics_admin_stats_jours(p_jours) : pages creees et visites PAR JOUR.
--   BLOC 4 - OPTIONNEL : un index partiel sur page_views, a ne creer QUE si les statistiques sont
--     lentes.
--
-- DEFINITIONS. p_jours est borne a 1-365. La periode compte p_jours jours calendaires, aujourd hui
-- compris (fuseau Africa/Porto-Novo, comme profil_public_visites_mien).
--   pages_total          : toutes les pages.
--   pages_publiees       : publiees et non suspendues (reellement publiques).
--   pages_brouillon      : non publiees et non suspendues.
--   pages_suspendues     : suspendues (publiees ou non). Les trois se somment en pages_total.
--   pages_nouvelles_7j   : pages CREEES (date cree_le, brouillons compris) depuis 7 jours glissants.
--   pages_nouvelles_30j  : idem depuis 30 jours glissants.
--   pages_messages_ouverts : pages publiees, non suspendues, qui acceptent les messages.
--   alias_total          : adresses supplementaires (alias) existantes.
--   signalements_non_traites : signalements non traites (un par membre et par page).
--   signalements_a_examiner  : pages avec au moins 3 signaleurs distincts non traites (meme seuil
--                              que la liste des signalements).
--   visites_total        : toutes les visites enregistrees de /m.html (toutes adresses), depuis le
--                          debut.
--   visites_periode      : celles de la periode.
--   visites_par_source   : qr, lien (direct, partage, whatsapp, facebook, instagram, tiktok) et
--                          autre, pour la periode : meme classification que
--                          profil_public_visites_mien.
--   top_pages            : 10 pages au plus (adresse, nom affiche, visites) pour la periode, par
--                          visites decroissantes puis adresse. Une visite compte sous l adresse
--                          principale (celle de /m.html), meme si l entree se fait par un alias.
-- Les visites des deux marques sont comptees (mahouto et majeste : une page ouverte via
-- majestepresse.com est enregistree sous la marque majeste). Seuls les filtres page_type = other,
-- path = /m.html et item_id non nul s appliquent.
-- ATTENTION : profil_public_visites_mien (la vue du membre) ne compte que la marque mahouto : pour une
-- meme page, le total vu par l administrateur peut etre superieur a celui vu par le membre.
--
-- RETRAIT : profils-publics-stats-rollback.sql (drop function if exists). Rien d autre n est
-- touche.
-- =========================================================


-- BLOC 1 - Verification des prerequis (ne modifie rien)
do $$
begin
  if to_regclass('public.profils_publics') is null
     or to_regclass('public.profils_publics_signalements') is null
     or to_regclass('public.profils_publics_alias') is null
     or to_regclass('public.page_views') is null then
    raise exception 'Tables des profils publics, signalements, alias ou page_views introuvables';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'profils_publics'
                    and column_name = 'messages_ouverts') then
    raise exception 'Colonne messages_ouverts introuvable : profils-publics-ecrire.sql';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'Fonction is_admin() introuvable';
  end if;
end $$;


-- BLOC 2 - Les chiffres : une seule ligne, refus immediat si pas administrateur
create or replace function public.profils_publics_admin_stats(p_jours integer default 30)
 returns table (pages_total integer, pages_publiees integer, pages_brouillon integer,
                pages_suspendues integer, pages_nouvelles_7j integer, pages_nouvelles_30j integer,
                pages_messages_ouverts integer, alias_total integer, signalements_a_examiner integer,
                signalements_non_traites integer, visites_total bigint, visites_periode bigint,
                visites_par_source jsonb, top_pages jsonb)
 language plpgsql
 stable
 security definer
 set search_path = public, pg_temp
as $$
declare
  v_jours integer := least(greatest(coalesce(p_jours, 30), 1), 365);
  v_fin date := (now() at time zone 'Africa/Porto-Novo')::date;
  v_debut timestamptz;
  v_qr bigint;
  v_lien bigint;
begin
  if not public.is_admin() then
    return;
  end if;
  v_debut := ((v_fin - (v_jours - 1))::timestamp at time zone 'Africa/Porto-Novo');
  select count(*)::integer,
         (count(*) filter (where p.publie and not p.suspendu))::integer,
         (count(*) filter (where not p.publie and not p.suspendu))::integer,
         (count(*) filter (where p.suspendu))::integer,
         (count(*) filter (where p.cree_le >= now() - interval '7 days'))::integer,
         (count(*) filter (where p.cree_le >= now() - interval '30 days'))::integer,
         (count(*) filter (where p.publie and not p.suspendu and p.messages_ouverts))::integer
    into pages_total, pages_publiees, pages_brouillon, pages_suspendues,
         pages_nouvelles_7j, pages_nouvelles_30j, pages_messages_ouverts
    from public.profils_publics p;
  select count(*)::integer into alias_total from public.profils_publics_alias a;
  select (count(*) filter (where not s.traite))::integer
    into signalements_non_traites
    from public.profils_publics_signalements s;
  select count(*)::integer into signalements_a_examiner
    from (select s.page_id
            from public.profils_publics_signalements s
           where not s.traite
           group by s.page_id
          having count(distinct s.signaleur_id) >= 3) q;
  select count(*),
         count(*) filter (where v.created_at >= v_debut),
         count(*) filter (where v.created_at >= v_debut and v.source = 'qr'),
         count(*) filter (where v.created_at >= v_debut
                            and v.source in ('direct', 'partage', 'whatsapp', 'facebook',
                                             'instagram', 'tiktok'))
    into visites_total, visites_periode, v_qr, v_lien
    from public.page_views v
   where v.page_type = 'other' and v.path = '/m.html'
     and v.item_id is not null;
  visites_par_source := jsonb_build_object('qr', v_qr, 'lien', v_lien,
                                           'autre', visites_periode - v_qr - v_lien);
  select coalesce(jsonb_agg(jsonb_build_object('adresse', t.adresse, 'nom', t.nom, 'visites', t.n)
                            order by t.n desc, t.adresse), '[]'::jsonb)
    into top_pages
    from (select p.adresse, p.nom_affiche as nom, count(*) as n
            from public.page_views v
            join public.profils_publics p on p.adresse = v.item_id
           where v.page_type = 'other' and v.path = '/m.html'
             and v.created_at >= v_debut
           group by p.adresse, p.nom_affiche
           order by count(*) desc, p.adresse
           limit 10) t;
  return next;
end;
$$;

revoke all on function public.profils_publics_admin_stats(integer) from public, anon;

grant execute on function public.profils_publics_admin_stats(integer) to authenticated;


-- BLOC 3 - Par jour : pages creees et visites (pour tracer une courbe)
create or replace function public.profils_publics_admin_stats_jours(p_jours integer default 30)
 returns table (jour date, pages_creees integer, visites integer)
 language plpgsql
 stable
 security definer
 set search_path = public, pg_temp
as $$
declare
  v_jours integer := least(greatest(coalesce(p_jours, 30), 1), 365);
  v_fin date := (now() at time zone 'Africa/Porto-Novo')::date;
  v_debut date := (now() at time zone 'Africa/Porto-Novo')::date - (v_jours - 1);
begin
  if not public.is_admin() then
    return;
  end if;
  return query
    with jours as (
      select g::date as j from generate_series(v_debut, v_fin, interval '1 day') g
    ), nouvelles as (
      select (p.cree_le at time zone 'Africa/Porto-Novo')::date as j, count(*) as n
        from public.profils_publics p
       where p.cree_le >= (v_debut::timestamp at time zone 'Africa/Porto-Novo')
       group by 1
    ), vues as (
      select (v.created_at at time zone 'Africa/Porto-Novo')::date as j, count(*) as n
        from public.page_views v
       where v.page_type = 'other' and v.path = '/m.html'
         and v.item_id is not null
         and v.created_at >= (v_debut::timestamp at time zone 'Africa/Porto-Novo')
       group by 1
    )
    select d.j, coalesce(a.n, 0)::integer, coalesce(b.n, 0)::integer
      from jours d
      left join nouvelles a on a.j = d.j
      left join vues b on b.j = d.j
     order by d.j;
end;
$$;

revoke all on function public.profils_publics_admin_stats_jours(integer) from public, anon;

grant execute on function public.profils_publics_admin_stats_jours(integer) to authenticated;


-- BLOC 4 - OPTIONNEL : index partiel sur les seules visites de pages publiques (petit)
-- A ne creer QUE si le tableau de bord devient lent (beaucoup de lignes dans page_views). Il ne filtre
-- pas sur brand : les deux marques sont comptees. Ce bloc modifie la base (un index) : il est
-- volontairement separe et facultatif. Retrait : BLOC 2 du rollback. Si une ancienne version de cet
-- index (avec un filtre sur brand) a ete creee pour un essai, la retirer d abord : la creation
-- conditionnelle ci-dessous ne la remplace pas.
create index if not exists page_views_profils_idx
  on public.page_views (created_at) include (item_id, source)
  where page_type = 'other' and path = '/m.html';
