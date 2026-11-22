-- =========================================================
-- MAHOUTO+ - Institut SAYÉ LOUIS : RETOUR ARRIERE de institut-regles.sql (PR 6)
--
-- ATTENTION : ce fichier SUPPRIME les colonnes situation et parrain_majeur de institut_demandes : les valeurs
-- saisies sont DEFINITIVEMENT PERDUES (operation irreversible : exportez-les d abord si besoin). Il remet aussi
-- la contrainte d age de 3 a 35 ans (une demande de 14 a 25 ans reste valide) et la fonction de garde d origine.
-- Il ne touche ni aux paiements, ni aux places, ni a aucune autre table.
--
-- A EXECUTER A LA MAIN, apres relecture, bloc par bloc. Par securite, le BLOC 1 refuse de s executer tant que
-- la ligne confirmation n est pas passee de NON a OUI. Relancable sans erreur.
-- Deployez d abord le code precedent (sans la PR 6) : il n envoie pas ces deux colonnes.
--
-- BLOCS : 1 confirmation et avertissement - 2 fonction de garde et droit d insertion d origine - 3 contraintes et colonnes.
-- =========================================================


-- BLOC 1 - Confirmation et avertissement (ne supprime rien)
do $$
declare
  confirmation constant text := 'NON';
  n_demandes integer := 0;
  n_deux integer := 0;
begin
  if to_regclass('public.institut_demandes') is not null then
    select count(*) into n_demandes from public.institut_demandes;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'institut_demandes' and column_name = 'situation') then
      execute 'select count(*) from public.institut_demandes where situation = ''deux_parents''' into n_deux;
    end if;
  end if;
  raise warning 'ATTENTION : les colonnes situation et parrain_majeur de % demande(s) (dont % orphelin(s) des deux parents) seront DEFINITIVEMENT PERDUES.', n_demandes, n_deux;
  if confirmation <> 'OUI' then
    raise exception 'Retour arriere NON confirme : aucune suppression effectuee. Editez ce fichier (confirmation := OUI) pour continuer.';
  end if;
end $$;


-- BLOC 2 - Fonction de garde d origine (sans situation ni parrain_majeur) et droit d insertion d origine
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

drop trigger if exists institut_demandes_garde_trg on public.institut_demandes;

create trigger institut_demandes_garde_trg
  before insert or update on public.institut_demandes
  for each row execute function public.institut_demandes_garde();

revoke insert on public.institut_demandes from authenticated;

grant insert (id, parrain_id, prenom, age, lien, formation, motif, justificatif_path, statut)
  on public.institut_demandes to authenticated;


-- BLOC 3 - Contraintes d origine (age de 3 a 35 ans) puis suppression des deux colonnes
alter table public.institut_demandes drop constraint if exists institut_demandes_parrain_majeur_check;

alter table public.institut_demandes drop constraint if exists institut_demandes_situation_check;

alter table public.institut_demandes drop constraint if exists institut_demandes_age_check;

alter table public.institut_demandes
  add constraint institut_demandes_age_check check (age between 3 and 35);

alter table public.institut_demandes drop column if exists parrain_majeur;

alter table public.institut_demandes drop column if exists situation;
