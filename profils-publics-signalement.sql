-- =========================================================
-- MAHOUTO+ - Profil public : SIGNALEMENT d une page publique (PR 2 sur 3)
--
-- Un membre connecte signale une page /m/adresse. Les administrateurs voient les pages signalees et les traitent.
-- Rien n est montre a la personne signalee. AUCUNE suspension automatique : le seuil de 3 signaleurs distincts
-- non traites ne fait que marquer la page a examiner dans la liste des administrateurs.
--
-- ADDITIF : une nouvelle table et 6 fonctions. Les signalements de messages (message_reports) ne sont pas touches.
-- La table n a AUCUN acces direct pour anon ni authenticated : tout passe par des fonctions security definer.
--
-- A EXECUTER A LA MAIN dans Supabase (SQL Editor), d abord sur un projet de TEST, BLOC PAR BLOC : copier un bloc,
-- l executer, passer au suivant. Chaque bloc est court, autonome et se relance sans erreur. Aucun commentaire
-- ne contient d apostrophe et tous les commentaires sont AVANT les instructions (collage mobile).
-- Prerequis : profils-publics.sql (blocs 1 a 11) deja execute. A executer AVANT la fusion de la PR.
--
-- BLOCS (dans l ordre) :
--   BLOC 1 - Verification des prerequis. Ne modifie rien.
--   BLOC 2 - Table profils_publics_signalements (colonnes).
--   BLOC 3 - Contraintes (motif, detail, un signalement par membre et par page) et index.
--   BLOC 4 - Securite : RLS activee, aucun droit pour anon ni authenticated.
--   BLOC 5 - Fonction interne : adresse valide (sans expression reguliere).
--   BLOC 6 - Fonction profil_public_signaler (membres connectes).
--   BLOC 7 - Fonction administrateur : lister les pages signalees.
--   BLOC 8 - Fonctions administrateur : detail d une page, marquer comme traite.
--
-- CODES RENVOYES PAR profil_public_signaler : ok, deja, propre_page, introuvable, limite, invalide, ferme.
-- Ordre des controles : invalide, ferme (sauf administrateur), introuvable, propre_page, deja, limite (10 par 24 h).
--
-- Retour arriere : profils-publics-signalement-rollback.sql.  Verification : profils-publics-signalement-verification.sql.
-- =========================================================


-- BLOC 1 - Verification des prerequis (ne modifie rien)
do $$
begin
  if to_regclass('public.profils_publics') is null then
    raise exception 'Table profils_publics introuvable : executez d abord profils-publics.sql';
  end if;
  if to_regprocedure('public.profils_publics_ouvert()') is null then
    raise exception 'Fonction profils_publics_ouvert() introuvable : executez d abord profils-publics.sql';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'Fonction is_admin() introuvable : executez d abord supabase-schema.sql';
  end if;
end $$;


-- BLOC 2 - Table des signalements (instantane de l adresse et du nom au moment du signalement)
create table if not exists public.profils_publics_signalements (
  id bigint generated always as identity primary key,
  page_id uuid not null references public.profils_publics(id) on delete cascade,
  signaleur_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  motif text not null,
  detail text,
  adresse_vue text not null,
  nom_vu text not null,
  cree_le timestamptz not null default now(),
  traite boolean not null default false,
  traite_le timestamptz
);


-- BLOC 3 - Contraintes et index
alter table public.profils_publics_signalements drop constraint if exists pps_motif_check;

alter table public.profils_publics_signalements
  add constraint pps_motif_check
  check (motif in ('spam', 'usurpation', 'arnaque', 'inapproprie', 'donnees_personnelles', 'autre'));

alter table public.profils_publics_signalements drop constraint if exists pps_detail_check;

alter table public.profils_publics_signalements
  add constraint pps_detail_check check (detail is null or char_length(detail) <= 300);

alter table public.profils_publics_signalements drop constraint if exists pps_traite_check;

alter table public.profils_publics_signalements
  add constraint pps_traite_check check (traite = (traite_le is not null));

alter table public.profils_publics_signalements drop constraint if exists pps_unique_par_membre;

alter table public.profils_publics_signalements
  add constraint pps_unique_par_membre unique (page_id, signaleur_id);

create index if not exists pps_signaleur_idx on public.profils_publics_signalements (signaleur_id, cree_le desc);


-- BLOC 4 - Securite : RLS activee, aucun droit direct (ni lecture ni ecriture) pour anon et authenticated
alter table public.profils_publics_signalements enable row level security;

revoke all on public.profils_publics_signalements from public;

revoke all on public.profils_publics_signalements from anon, authenticated;


-- BLOC 5 - Fonction interne : adresse valide (3 a 30 caracteres, minuscules, chiffres, tirets, pas de tiret aux bords)
create or replace function public.profils_publics_adresse_valide(p_adresse text)
 returns boolean
 language sql
 immutable
 set search_path = public, pg_temp
as $$
  select p_adresse is not null
     and length(p_adresse) between 3 and 30
     and translate(p_adresse, 'abcdefghijklmnopqrstuvwxyz0123456789-', '') = ''
     and not starts_with(p_adresse, '-')
     and right(p_adresse, 1) <> '-';
$$;

revoke all on function public.profils_publics_adresse_valide(text) from public, anon, authenticated;


-- BLOC 6 - Signaler une page (membres connectes seulement) : renvoie un code texte, prend elle-meme l instantane
create or replace function public.profil_public_signaler(p_adresse text, p_motif text, p_detail text)
 returns text
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_page record;
  v_detail text;
  v_n integer;
begin
  if v_uid is null or not public.profils_publics_adresse_valide(p_adresse) then
    return 'invalide';
  end if;
  if p_motif is null
     or p_motif not in ('spam', 'usurpation', 'arnaque', 'inapproprie', 'donnees_personnelles', 'autre') then
    return 'invalide';
  end if;
  v_detail := translate(coalesce(p_detail, ''), chr(9) || chr(10) || chr(13), '   ');
  v_detail := nullif(btrim(regexp_replace(v_detail, '[[:cntrl:]]', '', 'g')), '');
  if char_length(coalesce(v_detail, '')) > 300 then
    return 'invalide';
  end if;
  if not public.profils_publics_ouvert() and not public.is_admin() then
    return 'ferme';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pps:' || v_uid::text, 0));
  select p.id, p.user_id, p.adresse, p.nom_affiche into v_page
    from public.profils_publics p
   where p.adresse = p_adresse and p.publie and not p.suspendu;
  if not found then
    return 'introuvable';
  end if;
  if v_page.user_id = v_uid then
    return 'propre_page';
  end if;
  if exists (select 1 from public.profils_publics_signalements s
              where s.page_id = v_page.id and s.signaleur_id = v_uid) then
    return 'deja';
  end if;
  select count(*) into v_n from public.profils_publics_signalements s
   where s.signaleur_id = v_uid and s.cree_le > now() - interval '24 hours';
  if v_n >= 10 then
    return 'limite';
  end if;
  begin
    insert into public.profils_publics_signalements (page_id, signaleur_id, motif, detail, adresse_vue, nom_vu)
    values (v_page.id, v_uid, p_motif, v_detail, v_page.adresse, v_page.nom_affiche);
  exception when unique_violation then
    return 'deja';
  end;
  return 'ok';
end;
$$;

revoke all on function public.profil_public_signaler(text, text, text) from public, anon;

grant execute on function public.profil_public_signaler(text, text, text) to authenticated;


-- BLOC 7 - Administrateurs : une ligne par page signalee, sans identite de signaleur
-- a_examiner est vrai des 3 signaleurs distincts non traites (simple indicateur, aucune suspension)
create or replace function public.profils_publics_signalements_admin_lister()
 returns table (page_id uuid, adresse text, nom_affiche text, publie boolean, suspendu boolean,
                nb_signaleurs integer, nb_non_traites integer, motifs jsonb,
                dernier_le timestamptz, a_examiner boolean)
 language plpgsql
 stable
 security definer
 set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Reserve aux administrateurs.';
  end if;
  return query
    with par_motif as (
      select s.page_id as pid, s.motif as mot, count(*)::integer as n
        from public.profils_publics_signalements s group by s.page_id, s.motif
    ), motifs as (
      select m.pid, jsonb_object_agg(m.mot, m.n) as j from par_motif m group by m.pid
    ), agg as (
      select s.page_id as pid,
             count(distinct s.signaleur_id)::integer as nb,
             (count(distinct s.signaleur_id) filter (where not s.traite))::integer as nbn,
             max(s.cree_le) as dernier
        from public.profils_publics_signalements s group by s.page_id
    )
    select p.id, p.adresse, p.nom_affiche, p.publie, p.suspendu, a.nb, a.nbn, m.j, a.dernier, a.nbn >= 3
      from agg a
      join public.profils_publics p on p.id = a.pid
      join motifs m on m.pid = a.pid
     order by a.nbn desc, a.nb desc, a.dernier desc;
end;
$$;

revoke all on function public.profils_publics_signalements_admin_lister() from public, anon;

grant execute on function public.profils_publics_signalements_admin_lister() to authenticated;


-- BLOC 8 - Administrateurs : detail des signalements d une page (sans identite) et marquage comme traite
create or replace function public.profils_publics_signalements_admin_detail(p_page_id uuid)
 returns table (id bigint, motif text, detail text, cree_le timestamptz, traite boolean)
 language plpgsql
 stable
 security definer
 set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Reserve aux administrateurs.';
  end if;
  return query
    select s.id, s.motif, s.detail, s.cree_le, s.traite
      from public.profils_publics_signalements s
     where s.page_id = p_page_id
     order by s.cree_le desc;
end;
$$;

revoke all on function public.profils_publics_signalements_admin_detail(uuid) from public, anon;

grant execute on function public.profils_publics_signalements_admin_detail(uuid) to authenticated;

create or replace function public.profils_publics_signalements_admin_traiter(p_page_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  if not public.is_admin() then
    raise exception 'Reserve aux administrateurs.';
  end if;
  update public.profils_publics_signalements
     set traite = true, traite_le = now()
   where page_id = p_page_id and not traite;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.profils_publics_signalements_admin_traiter(uuid) from public, anon;

grant execute on function public.profils_publics_signalements_admin_traiter(uuid) to authenticated;
