-- =========================================================
-- MAHOUTO+ - Profil public (PR 1 sur 3) : page publique /m/adresse, publiee volontairement par le membre
--
-- Ce fichier cree : un interrupteur general (profils_publics_reglages, ouvert = non par defaut), la table
-- public.profils_publics (une ligne par page), son declencheur de garde, ses regles RLS avec droits par colonne,
-- et quelques fonctions (lecture de sa propre page, disponibilite d une adresse, etat public d une adresse,
-- actions des administrateurs).
--
-- ADDITIF : aucune table existante n est modifiee. public.profiles reste fermee aux autres membres (migration 001) :
-- la page publique vit dans sa propre table et n expose JAMAIS user_id, majeur_declare ni suspendu.
-- Ne touche ni aux paiements, ni a l Institut, ni a profiles.
--
-- A EXECUTER A LA MAIN dans Supabase (SQL Editor), d abord sur un projet de TEST, BLOC PAR BLOC : copier un bloc,
-- l executer, passer au suivant. Chaque bloc est court, autonome et se relance sans erreur. Aucun commentaire
-- ne contient d apostrophe et tous les commentaires sont AVANT les instructions (collage mobile).
-- Prerequis : supabase-schema.sql (is_admin) et migrations/002_pseudos_reserves.sql (is_reserved_username).
-- ORDRE : executer ce fichier AVANT de deployer le code de la PR.
--
-- BLOCS (dans l ordre) :
--   BLOC 1  - Verification des prerequis. Ne modifie rien.
--   BLOC 2  - Interrupteur general : table de reglages, RLS (lecture publique, ecriture administrateurs).
--   BLOC 3  - Valeur de depart (ouvert = non) et fonction profils_publics_ouvert().
--   BLOC 4  - Table profils_publics : colonnes.
--   BLOC 5  - Contraintes de format de chaque champ, un seul contact, majorite exigee pour publier.
--   BLOC 6  - Fonction adresses reservees (liste fixe + liste des pseudos reserves).
--   BLOC 7  - Fonction de garde et declencheur (adresse figee, publication, suspension, dates).
--   BLOC 8  - RLS et droits : AUCUNE lecture directe pour anon, lecture reservee au proprietaire et aux administrateurs.
--   BLOC 9  - Fonctions du proprietaire : lire sa page, tester une adresse.
--   BLOC 10 - Fonctions publiques : lire UNE page par son adresse exacte, etat d une adresse (introuvable, non disponible, non ouverte).
--   BLOC 11 - Fonctions des administrateurs : lister, lire une page par adresse, suspendre, changer une adresse.
--
-- CHOIX DOCUMENTES
--   - Le public ne lit JAMAIS la table directement : anon n a aucun droit sur profils_publics, et il n existe plus de
--     politique de lecture publique. Une page ne se lit que par la fonction profil_public_lire(adresse), qui
--     renvoie au plus UNE ligne, pour une adresse exacte, si la page est publiee, non suspendue et la fonction ouverte.
--     Aucune liste, aucune recherche partielle. user_id, majeur_declare, suspendu, publie_le ne sont jamais renvoyes.
--   - authenticated n a, sur la table, que le droit de lire la colonne id (utile pour mettre a jour sa page par id) :
--     les politiques limitent cette lecture a sa propre ligne (administrateurs : toutes les lignes).
--   - Le proprietaire lit sa ligne complete (avec majeur_declare) par la fonction profil_public_mien(). Il ne lit
--     jamais suspendu et ne peut pas le modifier.
--   - Tant que ouvert = non, profil_public_lire ne renvoie rien. Le proprietaire (profil_public_mien) et les
--     administrateurs (profils_publics_admin_lire) voient leur page par fonction (apercu).
--   - Adresse figee : des la premiere publication (colonne publie_le), seule une personne administratrice peut la changer.
--     Ainsi, depublier puis changer l adresse ne permet pas de contourner la regle.
--
-- Retour arriere : profils-publics-rollback.sql.  Verification : profils-publics-verification.sql.
-- =========================================================


-- BLOC 1 - Verification des prerequis (ne modifie rien)
do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'Fonction is_admin() introuvable : executez d abord supabase-schema.sql';
  end if;
  if to_regprocedure('public.is_reserved_username(text)') is null then
    raise exception 'Fonction is_reserved_username(text) introuvable : executez d abord migrations/002_pseudos_reserves.sql';
  end if;
  if to_regclass('auth.users') is null then
    raise exception 'Table auth.users introuvable';
  end if;
end $$;


-- BLOC 2 - Interrupteur general : table de reglages, lecture publique, ecriture reservee aux administrateurs
create table if not exists public.profils_publics_reglages (
  cle text primary key,
  valeur text not null,
  maj_le timestamptz not null default now()
);

alter table public.profils_publics_reglages drop constraint if exists profils_publics_reglages_check;

alter table public.profils_publics_reglages
  add constraint profils_publics_reglages_check check (cle = 'ouvert' and valeur in ('oui', 'non'));

alter table public.profils_publics_reglages enable row level security;

revoke all on public.profils_publics_reglages from anon, authenticated;

grant select on public.profils_publics_reglages to anon, authenticated;

grant insert, update on public.profils_publics_reglages to authenticated;

drop policy if exists "profils_publics_reglages_lecture" on public.profils_publics_reglages;

create policy "profils_publics_reglages_lecture" on public.profils_publics_reglages
  for select to anon, authenticated using (true);

drop policy if exists "profils_publics_reglages_admin_insert" on public.profils_publics_reglages;

create policy "profils_publics_reglages_admin_insert" on public.profils_publics_reglages
  for insert to authenticated with check (public.is_admin());

drop policy if exists "profils_publics_reglages_admin_update" on public.profils_publics_reglages;

create policy "profils_publics_reglages_admin_update" on public.profils_publics_reglages
  for update to authenticated using (public.is_admin()) with check (public.is_admin());


-- BLOC 3 - Valeur de depart (ouvert = non, relancer ne la remplace jamais) et fonction qui la lit
insert into public.profils_publics_reglages (cle, valeur) values ('ouvert', 'non') on conflict (cle) do nothing;

create or replace function public.profils_publics_ouvert()
 returns boolean
 language sql
 stable
 set search_path = public, pg_temp
as $$
  select coalesce((select r.valeur = 'oui' from public.profils_publics_reglages r where r.cle = 'ouvert'), false);
$$;

revoke all on function public.profils_publics_ouvert() from public;

grant execute on function public.profils_publics_ouvert() to anon, authenticated;


-- BLOC 4 - Table profils_publics : une ligne par page publique (id propre a la page, jamais l identifiant du compte)
create table if not exists public.profils_publics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique default auth.uid() references auth.users(id) on delete cascade,
  adresse text not null unique,
  nom_affiche text not null,
  avatar_url text,
  metier text,
  presentation text,
  localisation text,
  contact_type text,
  contact_valeur text,
  publie boolean not null default false,
  majeur_declare boolean not null default false,
  suspendu boolean not null default false,
  publie_le timestamptz,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now()
);


-- BLOC 5 - Contraintes de format, un seul contact (whatsapp ou lien https), majorite exigee pour publier
alter table public.profils_publics drop constraint if exists profils_publics_adresse_check;

alter table public.profils_publics
  add constraint profils_publics_adresse_check check (adresse ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$');

alter table public.profils_publics drop constraint if exists profils_publics_nom_check;

alter table public.profils_publics
  add constraint profils_publics_nom_check
  check (char_length(btrim(nom_affiche)) between 1 and 60 and nom_affiche !~ '[[:cntrl:]]');

alter table public.profils_publics drop constraint if exists profils_publics_avatar_check;

alter table public.profils_publics
  add constraint profils_publics_avatar_check
  check (avatar_url is null or (avatar_url ~ '^https://[^[:space:][:cntrl:]]{4,}$' and char_length(avatar_url) <= 500));

alter table public.profils_publics drop constraint if exists profils_publics_textes_check;

alter table public.profils_publics
  add constraint profils_publics_textes_check
  check ((metier is null or (char_length(metier) <= 80 and metier !~ '[[:cntrl:]]'))
     and (presentation is null or (char_length(presentation) <= 280 and presentation !~ '[[:cntrl:]]'))
     and (localisation is null or (char_length(localisation) <= 60 and localisation !~ '[[:cntrl:]]')));

alter table public.profils_publics drop constraint if exists profils_publics_contact_check;

alter table public.profils_publics
  add constraint profils_publics_contact_check
  check (coalesce((contact_type is null and contact_valeur is null)
      or (contact_type = 'whatsapp' and contact_valeur ~ '^\+[1-9][0-9]{7,14}$')
      or (contact_type = 'lien' and contact_valeur ~ '^https://[^[:space:][:cntrl:]]{4,}$' and char_length(contact_valeur) <= 300), false));

alter table public.profils_publics drop constraint if exists profils_publics_majeur_check;

alter table public.profils_publics
  add constraint profils_publics_majeur_check check (not publie or majeur_declare);

alter table public.profils_publics drop constraint if exists profils_publics_publie_le_check;

alter table public.profils_publics
  add constraint profils_publics_publie_le_check check (not publie or publie_le is not null);


-- BLOC 6 - Adresses reservees : liste fixe (tirets ignores) puis liste des pseudos reserves existante
create or replace function public.profils_publics_adresse_reservee(p_adresse text)
 returns boolean
 language plpgsql
 stable
 set search_path = public, pg_temp
as $$
declare
  v_sans_tirets text := replace(coalesce(p_adresse, ''), '-', '');
  v_liste text[] := array[
    'admin', 'administrateur', 'administrator', 'api', 'support', 'aide', 'help', 'contact', 'mahouto', 'mahoutoplus',
    'mahoutoschool', 'majeste', 'majestepresse', 'majesteai', 'institut', 'sayelouis', 'fondateur', 'founder', 'annonces',
    'moderation', 'moderateur', 'securite', 'security', 'officiel', 'official', 'equipe', 'team', 'www', 'app', 'static',
    'assets', 'login', 'logout', 'signup', 'profil', 'profile', 'profils', 'settings', 'parametres', 'entreprise',
    'boutique', 'school', 'verify', 'null', 'undefined', 'root', 'system', 'messages', 'discussions', 'paiement', 'paiements'
  ];
begin
  if v_sans_tirets = any (v_liste) or coalesce(p_adresse, '') = any (v_liste) then
    return true;
  end if;
  return public.is_reserved_username(p_adresse) or public.is_reserved_username(v_sans_tirets);
end;
$$;

revoke all on function public.profils_publics_adresse_reservee(text) from public;

grant execute on function public.profils_publics_adresse_reservee(text) to authenticated, service_role;


-- BLOC 7 - Garde : adresse figee apres la premiere publication, majorite pour publier, suspension et identite reservees
create or replace function public.profils_publics_garde()
 returns trigger
 language plpgsql
 set search_path = public, pg_temp
as $$
declare
  v_serveur boolean := (auth.uid() is null) or (coalesce(auth.role(), '') = 'service_role');
  v_admin boolean := false;
begin
  v_admin := v_serveur or public.is_admin();
  new.modifie_le := now();

  if new.publie and not new.majeur_declare then
    raise exception 'Pour publier votre page, certifiez avoir 18 ans ou plus.';
  end if;

  if tg_op = 'INSERT' then
    new.cree_le := now();
    if not v_admin then
      if new.suspendu then
        raise exception 'Le champ suspendu est reserve aux administrateurs.';
      end if;
      new.publie_le := null;
    end if;
    if new.publie and new.publie_le is null then
      new.publie_le := now();
    end if;
    if not v_admin and public.profils_publics_adresse_reservee(new.adresse) then
      raise exception 'Cette adresse est reservee : choisissez-en une autre.';
    end if;
    return new;
  end if;

  if not v_admin then
    if new.id is distinct from old.id or new.user_id is distinct from old.user_id then
      raise exception 'Cette page ne peut pas changer de proprietaire.';
    end if;
    if new.suspendu is distinct from old.suspendu then
      raise exception 'Le champ suspendu est reserve aux administrateurs.';
    end if;
    if new.adresse is distinct from old.adresse then
      if old.publie_le is not null then
        raise exception 'Une fois la page publiee, son adresse ne peut plus etre modifiee.';
      end if;
      if public.profils_publics_adresse_reservee(new.adresse) then
        raise exception 'Cette adresse est reservee : choisissez-en une autre.';
      end if;
    end if;
    new.cree_le := old.cree_le;
    new.publie_le := old.publie_le;
  end if;

  if new.publie and new.publie_le is null then
    new.publie_le := now();
  end if;
  return new;
end;
$$;

drop trigger if exists profils_publics_garde_trg on public.profils_publics;

create trigger profils_publics_garde_trg
  before insert or update on public.profils_publics
  for each row execute function public.profils_publics_garde();


-- BLOC 8 - RLS et droits : aucune lecture directe pour anon ; proprietaire et administrateurs seuls, limites par les politiques
alter table public.profils_publics enable row level security;

revoke all on public.profils_publics from anon, authenticated;

drop policy if exists "profils_publics_lecture_publique" on public.profils_publics;

grant select (id)
  on public.profils_publics to authenticated;

grant insert (adresse, nom_affiche, avatar_url, metier, presentation, localisation, contact_type, contact_valeur, publie, majeur_declare)
  on public.profils_publics to authenticated;

grant update (adresse, nom_affiche, avatar_url, metier, presentation, localisation, contact_type, contact_valeur, publie, majeur_declare)
  on public.profils_publics to authenticated;

drop policy if exists "profils_publics_proprietaire_select" on public.profils_publics;

create policy "profils_publics_proprietaire_select" on public.profils_publics
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "profils_publics_admin_select" on public.profils_publics;

create policy "profils_publics_admin_select" on public.profils_publics
  for select to authenticated using (public.is_admin());

drop policy if exists "profils_publics_proprietaire_insert" on public.profils_publics;

create policy "profils_publics_proprietaire_insert" on public.profils_publics
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "profils_publics_proprietaire_update" on public.profils_publics;

create policy "profils_publics_proprietaire_update" on public.profils_publics
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "profils_publics_admin_update" on public.profils_publics;

create policy "profils_publics_admin_update" on public.profils_publics
  for update to authenticated using (public.is_admin()) with check (public.is_admin());


-- BLOC 9 - Fonctions du proprietaire : lire sa propre page (avec majeur_declare, sans suspendu) et tester une adresse
create or replace function public.profil_public_mien()
 returns table (id uuid, adresse text, nom_affiche text, avatar_url text, metier text, presentation text,
                localisation text, contact_type text, contact_valeur text, publie boolean, majeur_declare boolean)
 language sql
 stable
 security definer
 set search_path = public, pg_temp
as $$
  select p.id, p.adresse, p.nom_affiche, p.avatar_url, p.metier, p.presentation, p.localisation,
         p.contact_type, p.contact_valeur, p.publie, p.majeur_declare
    from public.profils_publics p
   where p.user_id = auth.uid();
$$;

revoke all on function public.profil_public_mien() from public, anon;

grant execute on function public.profil_public_mien() to authenticated;

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


-- BLOC 10 - Fonctions publiques : lire UNE page par son adresse exacte, et etat d une adresse quand rien n est renvoye
create or replace function public.profil_public_lire(p_adresse text)
 returns table (id uuid, adresse text, nom_affiche text, avatar_url text, metier text, presentation text,
                localisation text, contact_type text, contact_valeur text)
 language sql
 stable
 security definer
 set search_path = public, pg_temp
as $$
  select p.id, p.adresse, p.nom_affiche, p.avatar_url, p.metier, p.presentation, p.localisation, p.contact_type, p.contact_valeur
    from public.profils_publics p
   where p_adresse ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'
     and p.adresse = p_adresse
     and p.publie
     and not p.suspendu
     and public.profils_publics_ouvert()
   limit 1;
$$;

revoke all on function public.profil_public_lire(text) from public;

grant execute on function public.profil_public_lire(text) to anon, authenticated;

create or replace function public.profil_public_statut(p_adresse text)
 returns text
 language plpgsql
 stable
 security definer
 set search_path = public, pg_temp
as $$
declare
  v record;
begin
  if not public.profils_publics_ouvert() then
    return 'non_ouverte';
  end if;
  if p_adresse is null or p_adresse !~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$' then
    return 'introuvable';
  end if;
  select p.publie, p.suspendu into v from public.profils_publics p where p.adresse = p_adresse;
  if found and v.publie and v.suspendu then
    return 'non_disponible';
  end if;
  return 'introuvable';
end;
$$;

revoke all on function public.profil_public_statut(text) from public;

grant execute on function public.profil_public_statut(text) to anon, authenticated;


-- BLOC 11 - Fonctions des administrateurs : lister (toutes colonnes), lire une page par adresse, suspendre ou reactiver, changer une adresse
create or replace function public.profils_publics_admin_lister()
 returns table (id uuid, user_id uuid, adresse text, nom_affiche text, publie boolean, majeur_declare boolean,
                suspendu boolean, publie_le timestamptz, cree_le timestamptz, modifie_le timestamptz)
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
    select p.id, p.user_id, p.adresse, p.nom_affiche, p.publie, p.majeur_declare, p.suspendu, p.publie_le, p.cree_le, p.modifie_le
      from public.profils_publics p order by p.cree_le desc;
end;
$$;

revoke all on function public.profils_publics_admin_lister() from public, anon;

grant execute on function public.profils_publics_admin_lister() to authenticated;

create or replace function public.profils_publics_admin_lire(p_adresse text)
 returns table (id uuid, adresse text, nom_affiche text, avatar_url text, metier text, presentation text,
                localisation text, contact_type text, contact_valeur text, publie boolean)
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
    select p.id, p.adresse, p.nom_affiche, p.avatar_url, p.metier, p.presentation, p.localisation, p.contact_type, p.contact_valeur, p.publie
      from public.profils_publics p where p.adresse = p_adresse limit 1;
end;
$$;

revoke all on function public.profils_publics_admin_lire(text) from public, anon;

grant execute on function public.profils_publics_admin_lire(text) to authenticated;

create or replace function public.profils_publics_admin_suspendre(p_id uuid, p_suspendu boolean)
 returns boolean
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Reserve aux administrateurs.';
  end if;
  update public.profils_publics set suspendu = coalesce(p_suspendu, false) where id = p_id;
  return found;
end;
$$;

revoke all on function public.profils_publics_admin_suspendre(uuid, boolean) from public, anon;

grant execute on function public.profils_publics_admin_suspendre(uuid, boolean) to authenticated;

create or replace function public.profils_publics_admin_adresse(p_id uuid, p_adresse text)
 returns boolean
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Reserve aux administrateurs.';
  end if;
  update public.profils_publics set adresse = p_adresse where id = p_id;
  return found;
end;
$$;

revoke all on function public.profils_publics_admin_adresse(uuid, text) from public, anon;

grant execute on function public.profils_publics_admin_adresse(uuid, text) to authenticated;
