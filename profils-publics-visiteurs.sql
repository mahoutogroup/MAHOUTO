-- =========================================================
-- MAHOUTO+ - Profil public : Qui a vu ma carte (visiteurs connectes, avec accord de chacun)
--
-- Ce fichier cree : la table des preferences (profils_publics_visiteurs_reglages), la table des passages
-- (profils_publics_passages) et six fonctions : enregistrer un passage, lire et ecrire son
-- reglage, lister
-- les visiteurs de ma carte, purger les passages de plus de 30 jours (administrateur), plus les droits.
--
-- ADDITIF : aucune table ni fonction existante n est modifiee. Aucune statistique administrateur
-- n est touchee.
-- Aucune tache planifiee : la purge est une fonction a lancer a la main, et toutes les lectures
-- filtrent deja
-- sur moins de 30 jours.
--
-- A EXECUTER A LA MAIN dans Supabase (SQL Editor), BLOC PAR BLOC : copier un bloc, l executer, passer au
-- suivant. Chaque bloc est court, autonome et se relance sans erreur. Aucun commentaire ne contient
-- d apostrophe et tous les commentaires sont AVANT les instructions (collage mobile).
-- Prerequis : profils-publics.sql, profils-publics-signalement.sql, profils-publics-alias.sql et
-- messagerie-blocage.sql deja executes.
-- ORDRE : executer ce fichier AVANT de deployer le code de la PR. Sans lui, la page continue de
-- fonctionner :
-- l enregistrement est ignore en silence et la section du profil indique que la fonction est
-- indisponible.
--
-- BLOCS (dans l ordre) :
--   BLOC 1 - Verification des prerequis. Ne modifie rien.
--   BLOC 2 - Table des preferences : desactive par defaut, chacun ne lit que sa ligne.
--   BLOC 3 - Table des passages : RLS activee, AUCUNE politique, aucun droit direct.
--   BLOC 4 - Fonction profil_public_visiteur_enregistrer.
--   BLOC 5 - Fonctions du reglage : lire et ecrire (la desactivation efface les passages).
--   BLOC 6 - Fonction profil_public_visiteurs_lister (proprietaire, reciprocite, 30 jours, hors
--   bloques).
--   BLOC 7 - Fonction administrateur profil_public_visiteurs_purger.
--   BLOC 8 - Droits : rien pour anon, execution reservee aux membres connectes.
--
-- CHOIX DOCUMENTES
--   - OPT-IN : montrer_mon_nom vaut false par defaut. Sans accord, AUCUNE ligne n est enregistree.
--   - Les passages ne se lisent jamais directement : la table n a aucune politique et aucun
--   droit. La liste ne
--     sort que par profil_public_visiteurs_lister, sans identifiant de compte, sans heure : nom, adresse
--     publique si publiee, nombre de visites, jour du dernier passage.
--   - Le reglage ne s ecrit que par profil_public_visiteur_reglage_ecrire (aucun droit d ecriture
--   direct),
--     pour que la desactivation efface TOUJOURS les passages du visiteur dans la meme transaction.
--   - Une ligne par couple (proprietaire, visiteur). Le compteur n augmente qu une fois par tranche de
--     30 minutes (recharger la page ne gonfle rien) et repart a 1 apres 30 jours sans visite.
--   - La fonction d enregistrement renvoie toujours true : la reponse ne revele ni un blocage, ni
--   un refus.
--   - Le nom affiche est le pseudo du membre (profiles.username), jamais le nom legal complet.
--   - Un blocage dans un sens ou dans l autre (dm_bloque_entre) empeche l enregistrement ET
--   masque la ligne.
--
-- Retour arriere : profils-publics-visiteurs-rollback.sql.  Verification : profils-publics-
-- visiteurs-verification.sql.
-- =========================================================


-- BLOC 1 - Verification des prerequis (ne modifie rien)
do $$
begin
  if to_regclass('public.profils_publics') is null or to_regclass('public.profiles') is null then
    raise exception 'Tables profils_publics ou profiles introuvables';
  end if;
  if to_regprocedure('public.profils_publics_ouvert()') is null
     or to_regprocedure('public.profils_publics_adresse_valide(text)') is null
     or to_regprocedure('public.profil_public_alias_resoudre(text)') is null
     or to_regprocedure('public.is_admin()') is null then
    raise exception 'Fonctions des profils publics ou is_admin introuvables';
  end if;
  if to_regprocedure('public.dm_bloque_entre(uuid, uuid)') is null then
    raise exception 'dm_bloque_entre introuvable : executez d abord messagerie-blocage.sql';
  end if;
end $$;


-- BLOC 2 - Table des preferences : une ligne par membre, desactive par defaut, lecture de SA
-- ligne seulement
-- Aucun droit d ecriture direct : tout passe par profil_public_visiteur_reglage_ecrire
create table if not exists public.profils_publics_visiteurs_reglages (
  user_id uuid primary key references auth.users(id) on delete cascade,
  montrer_mon_nom boolean not null default false,
  mis_a_jour timestamptz not null default now()
);

alter table public.profils_publics_visiteurs_reglages enable row level security;

revoke all on public.profils_publics_visiteurs_reglages from public, anon, authenticated;

grant select on public.profils_publics_visiteurs_reglages to authenticated;

drop policy if exists "pp_visiteurs_reglages_lire_le_sien" on public.profils_publics_visiteurs_reglages;

create policy "pp_visiteurs_reglages_lire_le_sien" on public.profils_publics_visiteurs_reglages
  for select to authenticated using (user_id = auth.uid());


-- BLOC 3 - Table des passages : RLS activee, AUCUNE politique, aucun droit direct (tout passe par
-- les fonctions)
create table if not exists public.profils_publics_passages (
  proprietaire_id uuid not null references auth.users(id) on delete cascade,
  visiteur_id uuid not null references auth.users(id) on delete cascade,
  nb_visites integer not null default 1,
  premiere_visite timestamptz not null default now(),
  derniere_visite timestamptz not null default now(),
  primary key (proprietaire_id, visiteur_id),
  constraint pp_passages_pas_soi_meme check (proprietaire_id <> visiteur_id),
  constraint pp_passages_compteur check (nb_visites between 1 and 9999)
);

create index if not exists pp_passages_visiteur_idx on public.profils_publics_passages (visiteur_id);

create index if not exists pp_passages_derniere_idx on public.profils_publics_passages (derniere_visite);

alter table public.profils_publics_passages enable row level security;

revoke all on public.profils_publics_passages from public, anon, authenticated;


-- BLOC 4 - Enregistrer un passage (membre connecte, non anonyme, qui a dit oui)
-- Exclusions : page non publiee ou suspendue, fonction fermee, propre page, blocage dans un sens ou dans
-- l autre, reglage absent ou desactive. Renvoie toujours true, sans rien reveler. Le verrou evite qu un
-- passage soit ecrit pendant que le visiteur desactive son reglage.
create or replace function public.profil_public_visiteur_enregistrer(p_adresse text)
 returns boolean
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_claims jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  v_proprio uuid;
  v_adresse text;
begin
  if v_uid is null
     or coalesce((v_claims ->> 'is_anonymous')::boolean, false)
     or coalesce(v_claims -> 'app_metadata' ->> 'provider', '') = 'anonymous' then
    return true;
  end if;
  if not public.profils_publics_adresse_valide(p_adresse) or not public.profils_publics_ouvert() then
    return true;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ppv:' || v_uid::text, 0));
  if not coalesce((select r.montrer_mon_nom from public.profils_publics_visiteurs_reglages r
                    where r.user_id = v_uid), false) then
    return true;
  end if;
  v_adresse := p_adresse;
  select p.user_id into v_proprio from public.profils_publics p
   where p.adresse = v_adresse and p.publie and not p.suspendu;
  if not found then
    v_adresse := public.profil_public_alias_resoudre(p_adresse);
    if v_adresse is null then
      return true;
    end if;
    select p.user_id into v_proprio from public.profils_publics p
     where p.adresse = v_adresse and p.publie and not p.suspendu;
    if not found then
      return true;
    end if;
  end if;
  if v_proprio = v_uid or public.dm_bloque_entre(v_uid, v_proprio) then
    return true;
  end if;
  insert into public.profils_publics_passages as t (proprietaire_id, visiteur_id)
  values (v_proprio, v_uid)
  on conflict (proprietaire_id, visiteur_id) do update
    set nb_visites = case
          when t.derniere_visite < now() - interval '30 days' then 1
          when t.derniere_visite < now() - interval '30 minutes' then least(t.nb_visites + 1, 9999)
          else t.nb_visites end,
        premiere_visite = case
          when t.derniere_visite < now() - interval '30 days' then now()
          else t.premiere_visite end,
        derniere_visite = case
          when t.derniere_visite < now() - interval '30 minutes' then now()
          else t.derniere_visite end;
  return true;
end;
$$;


-- BLOC 5 - Le reglage : lire le sien, l ecrire. Desactiver EFFACE tous les passages ou je suis visiteur.
-- Les deux renvoient l etat enregistre (false si non connecte). L ecriture est refusee a un
-- compte anonyme.
create or replace function public.profil_public_visiteur_reglage_lire()
 returns boolean
 language sql
 stable
 security definer
 set search_path = public, pg_temp
as $$
  select coalesce((select r.montrer_mon_nom from public.profils_publics_visiteurs_reglages r
                    where r.user_id = auth.uid()), false);
$$;

create or replace function public.profil_public_visiteur_reglage_ecrire(p_actif boolean)
 returns boolean
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_claims jsonb := coalesce(auth.jwt(), '{}'::jsonb);
begin
  if v_uid is null or p_actif is null
     or coalesce((v_claims ->> 'is_anonymous')::boolean, false)
     or coalesce(v_claims -> 'app_metadata' ->> 'provider', '') = 'anonymous' then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ppv:' || v_uid::text, 0));
  insert into public.profils_publics_visiteurs_reglages as r (user_id, montrer_mon_nom, mis_a_jour)
  values (v_uid, p_actif, now())
  on conflict (user_id) do update set montrer_mon_nom = excluded.montrer_mon_nom, mis_a_jour = now();
  if not p_actif then
    delete from public.profils_publics_passages x where x.visiteur_id = v_uid;
  end if;
  return p_actif;
end;
$$;


-- BLOC 6 - Lister les visiteurs de MA carte
-- Aucune ligne si mon propre reglage est desactive (reciprocite). Seuls les visiteurs qui ont dit
-- oui, de
-- moins de 30 jours, hors blocage dans un sens ou dans l autre. Aucun identifiant, aucune heure :
-- nom (pseudo),
-- adresse publique du visiteur si sa page est publiee, nombre de visites, jour du dernier passage
-- (heure du
-- Benin). 100 lignes au plus.
create or replace function public.profil_public_visiteurs_lister()
 returns table (nom text, adresse text, nb_visites integer, dernier_jour date)
 language plpgsql
 stable
 security definer
 set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_claims jsonb := coalesce(auth.jwt(), '{}'::jsonb);
begin
  if v_uid is null
     or coalesce((v_claims ->> 'is_anonymous')::boolean, false)
     or coalesce(v_claims -> 'app_metadata' ->> 'provider', '') = 'anonymous' then
    return;
  end if;
  if not coalesce((select r.montrer_mon_nom from public.profils_publics_visiteurs_reglages r
                    where r.user_id = v_uid), false) then
    return;
  end if;
  return query
  select pr.username::text,
         case when pp.id is not null then pp.adresse else null end,
         x.nb_visites,
         (x.derniere_visite at time zone 'Africa/Porto-Novo')::date
    from public.profils_publics_passages x
    join public.profils_publics_visiteurs_reglages rv
      on rv.user_id = x.visiteur_id and rv.montrer_mon_nom
    join public.profiles pr on pr.id = x.visiteur_id
    left join public.profils_publics pp
      on pp.user_id = x.visiteur_id and pp.publie and not pp.suspendu and public.profils_publics_ouvert()
   where x.proprietaire_id = v_uid
     and x.derniere_visite > now() - interval '30 days'
     and not public.dm_bloque_entre(v_uid, x.visiteur_id)
   order by x.derniere_visite desc
   limit 100;
end;
$$;


-- BLOC 7 - Administrateur : purger les passages de plus de 30 jours (renvoie seulement le nombre
-- de lignes)
-- Aucune vue nominative pour l administrateur : cette fonction ne lit aucun nom.
create or replace function public.profil_public_visiteurs_purger()
 returns integer
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  if not public.is_admin() then
    raise exception 'Reserve aux administrateurs' using errcode = '42501';
  end if;
  delete from public.profils_publics_passages x where x.derniere_visite < now() - interval '30 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;


-- BLOC 8 - Droits : rien pour le public ni pour anon, execution reservee aux membres connectes
revoke all on function public.profil_public_visiteur_enregistrer(text) from public, anon;

revoke all on function public.profil_public_visiteur_reglage_lire() from public, anon;

revoke all on function public.profil_public_visiteur_reglage_ecrire(boolean) from public, anon;

revoke all on function public.profil_public_visiteurs_lister() from public, anon;

revoke all on function public.profil_public_visiteurs_purger() from public, anon;

grant execute on function public.profil_public_visiteur_enregistrer(text) to authenticated;

grant execute on function public.profil_public_visiteur_reglage_lire() to authenticated;

grant execute on function public.profil_public_visiteur_reglage_ecrire(boolean) to authenticated;

grant execute on function public.profil_public_visiteurs_lister() to authenticated;

grant execute on function public.profil_public_visiteurs_purger() to authenticated;
