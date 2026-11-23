-- =========================================================
-- MAHOUTO+ - Profil public : FINITIONS (rappel d ouverture, classement des sources)
--
-- Deux petites choses :
--   1. Un declencheur met maj_le a now() quand la valeur de l interrupteur change
--      (profils_publics_reglages). Il couvre aussi les changements faits a la main
--      dans l editeur SQL. La page admin s en sert pour afficher depuis combien de
--      temps la fonction est OUVERTE. Le declencheur n est pas security definer et
--      ne touche que maj_le.
--   2. La fonction profil_public_visites_mien classe aussi la source partage dans
--      la categorie lien (valeur mise par le lien de partage quand aucune autre
--      source n est connue). Meme signature, memes colonnes, memes droits.
--
-- A EXECUTER A LA MAIN dans Supabase (SQL Editor), d abord sur un projet de TEST,
-- BLOC PAR BLOC : copier un bloc, l executer, passer au suivant. Chaque bloc est
-- court, autonome et se relance sans erreur. Aucun commentaire ne contient
-- d apostrophe et tous les commentaires sont AVANT les instructions.
-- Prerequis : profils-publics.sql et profils-publics-visites.sql deja executes.
-- A executer AVANT la fusion de la PR.
--
-- BLOCS (dans l ordre) :
--   BLOC 1 - Verification des prerequis. Ne modifie rien.
--   BLOC 2 - Fonction et declencheur de mise a jour de maj_le.
--   BLOC 3 - Fonction profil_public_visites_mien (liste des sources mise a jour).
--
-- SOURCES POSSIBLES POUR UNE PAGE PUBLIQUE (analytics.js et api/_profil-og.js)
--   Le lien de partage ajoute toujours src : qr (valeur du lien), facebook,
--   instagram ou tiktok (navigateurs integres), sinon partage.
--   Ouverture directe de /m.html sans src : direct, whatsapp, facebook, instagram,
--   tiktok, search (moteur de recherche), autre (autre site).
--   Valeur libre dans le lien (par exemple src=newsletter) : tout ce qui reste.
--   qr    : source = qr
--   lien  : direct, partage, whatsapp, facebook, instagram, tiktok
--   autre : search, autre et toute valeur libre
--
-- Retour arriere : profils-publics-finitions-rollback.sql.
-- Verification : profils-publics-finitions-verification.sql.
-- =========================================================


-- BLOC 1 - Verification des prerequis (ne modifie rien)
do $$
begin
  if to_regclass('public.profils_publics_reglages') is null then
    raise exception 'Table profils_publics_reglages introuvable : executez profils-publics.sql';
  end if;
  if to_regprocedure('public.profil_public_visites_mien(integer)') is null then
    raise exception 'Fonction profil_public_visites_mien introuvable : profils-publics-visites.sql';
  end if;
end $$;


-- BLOC 2 - Declencheur : maj_le suit les changements de valeur
-- (pas security definer, ne touche que maj_le)
create or replace function public.profils_publics_reglages_maj()
 returns trigger
 language plpgsql
 set search_path = public, pg_temp
as $$
begin
  if old.valeur is distinct from new.valeur then
    new.maj_le := now();
  end if;
  return new;
end;
$$;

revoke all on function public.profils_publics_reglages_maj() from public, anon, authenticated;

drop trigger if exists profils_publics_reglages_maj_trg on public.profils_publics_reglages;

create trigger profils_publics_reglages_maj_trg
  before update on public.profils_publics_reglages
  for each row execute function public.profils_publics_reglages_maj();


-- BLOC 3 - Visites de MA page : la source partage compte comme lien
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
                  when v.source in ('direct', 'partage', 'whatsapp', 'facebook',
                                    'instagram', 'tiktok')
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
