-- =========================================================
-- MAHOUTO+ - Institut SAYÉ LOUIS : application du reglement (PR 6)
--
-- Regles appliquees a la table public.institut_demandes :
--   1. age accepte : de 14 a 25 ans (avant : 3 a 35). La regle lui_meme exige 18 ans ou plus reste.
--   2. orphelin de moins de 18 ans : le parrain est obligatoirement majeur, il le certifie
--      (colonne parrain_majeur, exigee par la base quand age est inferieur a 18).
--   3. situation de l orphelin, obligatoire : pere, mere ou deux_parents (priorite aux orphelins des deux parents).
--
-- ADDITIF : seule la table institut_demandes change (2 colonnes, 2 contraintes remplacees ou ajoutees, droit
-- d insertion elargi, fonction de garde remplacee). Rien sur les paiements, les places, les formations,
-- purchases, messages, rooms, profiles.
--
-- A EXECUTER A LA MAIN dans Supabase (SQL Editor), d abord sur un projet de TEST, BLOC PAR BLOC : copier un bloc,
-- l executer, passer au suivant. Chaque bloc est court, autonome et se relance sans erreur. Aucun commentaire
-- ne contient d apostrophe et tous les commentaires sont AVANT les instructions (collage mobile).
-- Prerequis : institut.sql (PR 2) deja execute.
--
-- BLOCS (dans l ordre) :
--   BLOC 1 - Verification des prerequis. Ne modifie rien.
--   BLOC 2 - Colonnes situation et parrain_majeur (lignes existantes : valeurs par defaut raisonnables).
--   BLOC 3 - Contrainte d age : 14 a 25 ans.
--   BLOC 4 - Contrainte de situation : pere, mere ou deux_parents.
--   BLOC 5 - Contrainte de majorite du parrain : age >= 18 ou parrain_majeur = true.
--   BLOC 6 - Droit d insertion : les deux nouvelles colonnes sont renseignees par le parrain a l insertion.
--   BLOC 7 - Fonction de garde : les deux nouvelles colonnes sont figees apres le depot.
--   BLOC 8 - Declencheur de garde (recree).
--
-- LIGNES EXISTANTES (il n y en a aucune en production aujourd hui, la migration reste sure si elles existent) :
--   situation : les lignes existantes recoivent la valeur pere (valeur par defaut a verifier ensuite) ;
--   parrain_majeur : false pour les lignes existantes ; les contraintes d age et de majorite sont ajoutees en
--   NOT VALID puis validees si possible : une ligne ancienne hors regle ne bloque pas la migration, un message
--   (NOTICE) la signale, et elle ne peut plus etre modifiee tant qu elle n est pas corrigee a la main.
--
-- Retour arriere : institut-regles-rollback.sql.  Verification : institut-regles-verification.sql.
-- =========================================================


-- BLOC 1 - Verification des prerequis (ne modifie rien)
do $$
begin
  if to_regclass('public.institut_demandes') is null then
    raise exception 'Table institut_demandes introuvable : executez d abord institut.sql (PR 2)';
  end if;
  if to_regprocedure('public.institut_demandes_garde()') is null then
    raise exception 'Fonction institut_demandes_garde() introuvable : executez d abord institut.sql (PR 2)';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'Fonction is_admin() introuvable : executez d abord supabase-schema.sql';
  end if;
end $$;


-- BLOC 2 - Colonnes : situation (valeur par defaut retiree apres remplissage des lignes existantes) et parrain_majeur
alter table public.institut_demandes add column if not exists situation text;

update public.institut_demandes set situation = 'pere' where situation is null;

alter table public.institut_demandes alter column situation set not null;

alter table public.institut_demandes add column if not exists parrain_majeur boolean not null default false;


-- BLOC 3 - Age : 14 a 25 ans (ancienne contrainte supprimee puis recreee ; NOT VALID puis validation si possible)
alter table public.institut_demandes drop constraint if exists institut_demandes_age_check;

alter table public.institut_demandes
  add constraint institut_demandes_age_check check (age between 14 and 25) not valid;

do $$
begin
  alter table public.institut_demandes validate constraint institut_demandes_age_check;
exception when check_violation then
  raise notice 'Des demandes existantes ont un age hors de 14 a 25 ans : la contrainte reste NOT VALID (nouvelles lignes controlees). Corrigez ces lignes a la main puis relancez ce bloc.';
end $$;


-- BLOC 4 - Situation de l orphelin : pere, mere ou deux_parents
alter table public.institut_demandes drop constraint if exists institut_demandes_situation_check;

alter table public.institut_demandes
  add constraint institut_demandes_situation_check check (situation in ('pere', 'mere', 'deux_parents'));


-- BLOC 5 - Majorite du parrain : exigee sous 18 ans (NOT VALID puis validation si possible)
alter table public.institut_demandes drop constraint if exists institut_demandes_parrain_majeur_check;

alter table public.institut_demandes
  add constraint institut_demandes_parrain_majeur_check check (age >= 18 or parrain_majeur = true) not valid;

do $$
begin
  alter table public.institut_demandes validate constraint institut_demandes_parrain_majeur_check;
exception when check_violation then
  raise notice 'Des demandes existantes de moins de 18 ans n ont pas la declaration de majorite : la contrainte reste NOT VALID (nouvelles lignes controlees). Corrigez ces lignes a la main puis relancez ce bloc.';
end $$;


-- BLOC 6 - Droit d insertion : le parrain renseigne situation et parrain_majeur a l insertion (jamais a la mise a jour)
revoke insert on public.institut_demandes from authenticated;

grant insert (id, parrain_id, prenom, age, lien, formation, motif, justificatif_path, statut, situation, parrain_majeur)
  on public.institut_demandes to authenticated;


-- BLOC 7 - Fonction de garde : champs deposes figes (situation et parrain_majeur ajoutes), traitement reserve aux admins
create or replace function public.institut_demandes_garde()
 returns trigger
 language plpgsql
 set search_path = public, pg_temp
as $$
declare
  v_serveur boolean := (auth.uid() is null) or (coalesce(auth.role(), '') = 'service_role');
  v_en_attente integer;
begin
  if tg_op = 'INSERT' then
    new.statut := 'en_attente';
    new.raison_refus := null;
    new.traite_le := null;
    new.traite_par := null;
    perform pg_advisory_xact_lock(hashtextextended(new.parrain_id::text, 0));
    select count(*) into v_en_attente
      from public.institut_demandes d
     where d.parrain_id = new.parrain_id and d.statut = 'en_attente';
    if v_en_attente >= 5 then
      raise exception 'Vous avez déjà 5 demandes en attente. Patientez avant de déposer une nouvelle demande : elles doivent être examinées.';
    end if;
    return new;
  end if;

  if not v_serveur then
    if new.id is distinct from old.id
       or new.parrain_id is distinct from old.parrain_id
       or new.prenom is distinct from old.prenom
       or new.age is distinct from old.age
       or new.lien is distinct from old.lien
       or new.formation is distinct from old.formation
       or new.motif is distinct from old.motif
       or new.justificatif_path is distinct from old.justificatif_path
       or new.situation is distinct from old.situation
       or new.parrain_majeur is distinct from old.parrain_majeur
       or new.cree_le is distinct from old.cree_le then
      raise exception 'Les informations de la demande ne peuvent plus être modifiées.';
    end if;
  end if;

  if new.statut is distinct from old.statut then
    if not v_serveur and not public.is_admin() then
      raise exception 'Seul un administrateur peut traiter une demande.';
    end if;
    if new.statut = 'en_attente' then
      new.traite_le := null;
      new.traite_par := null;
      new.raison_refus := null;
    else
      new.traite_le := now();
      new.traite_par := auth.uid();
      if new.statut <> 'refusee' then new.raison_refus := null; end if;
    end if;
  else
    if not v_serveur and not public.is_admin() and new.raison_refus is distinct from old.raison_refus then
      raise exception 'Seul un administrateur peut traiter une demande.';
    end if;
    if not v_serveur then
      new.traite_le := old.traite_le;
      new.traite_par := old.traite_par;
    end if;
  end if;
  return new;
end;
$$;


-- BLOC 8 - Declencheur de garde (meme nom qu avant : remplace l ancien)
drop trigger if exists institut_demandes_garde_trg on public.institut_demandes;

create trigger institut_demandes_garde_trg
  before insert or update on public.institut_demandes
  for each row execute function public.institut_demandes_garde();
