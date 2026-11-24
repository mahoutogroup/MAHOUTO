-- =========================================================
-- MAHOUTO+ - Invitations : un lien personnel par membre, avec un simple compteur (sans recompense)
--
-- Ce fichier cree : la table des codes (un code et un compteur par membre ayant une page publiee),
-- la table des comptes deja comptes (pour ne pas compter deux fois) et trois fonctions : lire mon code,
-- enregistrer un code (au retour de connexion d un nouveau compte) et les totaux anonymes pour
-- l administrateur, plus les droits.
--
-- CONFIDENTIALITE (le coeur du fichier)
--   - AUCUNE table ne relie un compte invite a un inviteur. La table des codes ne contient que le code
--     et le compteur. La table des comptes comptes ne contient que le compte et un jour : AUCUNE colonne
--     vers un code ou un inviteur. Le code utilise n est jamais conserve avec le compte.
--   - Le membre ne voit qu un nombre (invitation_mon_code). L administrateur ne voit que des totaux
--     (invitation_admin_totaux). Aucune liste de personnes, aucune date par personne.
--   - La table des codes n a volontairement AUCUNE colonne de date de mise a jour : on ne peut pas
--     rapprocher le moment du comptage d un compte.
--   - Les deux tables n ont aucune politique et aucun droit direct : tout passe par les fonctions.
--
-- A EXECUTER A LA MAIN dans Supabase (SQL Editor), BLOC PAR BLOC : copier un bloc, l executer, passer au
-- suivant. Chaque bloc est court, autonome et se relance sans erreur. Aucun commentaire ne contient
-- d apostrophe et tous les commentaires sont AVANT les instructions (collage mobile).
-- Prerequis : profils-publics.sql deja execute (profils_publics, is_admin).
-- ORDRE : executer ce fichier AVANT de deployer le code de la PR. Sans lui, rien ne casse : la
-- section du
-- profil reste masquee et l enregistrement du code est ignore en silence.
--
-- BLOCS (dans l ordre) :
--   BLOC 1 - Verification des prerequis (dont la lecture de auth.users). Ne modifie rien.
--   BLOC 2 - Table invitations_codes : RLS activee, aucune politique, aucun droit.
--   BLOC 3 - Table invitations_comptes_comptes : RLS activee, aucune politique, aucun droit.
--   BLOC 4 - Fonction invitation_mon_code (page publiee requise, cree le code si besoin).
--   BLOC 5 - Fonction invitation_enregistrer (renvoie toujours vrai).
--   BLOC 6 - Fonction administrateur invitation_admin_totaux (totaux anonymes).
--   BLOC 7 - Droits : rien pour anon ni public, execution reservee aux membres connectes.
--
-- CHOIX DOCUMENTES
--   - Code : 10 caracteres tires au hasard parmi 32 (50 bits), majuscules et chiffres sans lettres
--     ambigues (ni I, O, 0, 1). Jamais construit a partir d un identifiant. Format controle sans
--     expression reguliere : longueur, majuscules, caracteres de la liste.
--   - Un compte n est compte que s il a ete cree il y a moins de 2 jours (auth.users.created_at), s il
--     n est ni anonyme ni le proprietaire du code, et une seule fois (cle primaire). Un code inconnu ne
--     consomme pas le compte : une faute de frappe n empeche pas un comptage ulterieur.
--   - Le comptage et le compteur sont dans la meme transaction, sous verrou : pas de double comptage.
--   - invitation_enregistrer renvoie TOUJOURS vrai : rien ne revele qu un code existe ou est refuse.
--   - Le jour de comptage est une date (pas une heure) : moins de rapprochement possible.
--   - invitation_admin_totaux verifie is_admin() : elle ne se lit donc PAS depuis l editeur SQL
--   (auth.uid()
--     y est nul). Pour lire les totaux dans l editeur, voir les deux requetes en commentaire ci-dessous.
--
-- LIRE LES TOTAUX DANS L EDITEUR SQL (agregats seulement, aucune ligne de personne) :
--   select count(*) as codes, coalesce(sum(nb_inscrits), 0) as inscrits from public.invitations_codes;
--   select count(*) as codes_avec_inscrits from public.invitations_codes where nb_inscrits > 0;
--
-- Retour arriere : invitations-rollback.sql.  Verification : invitations-verification.sql.
-- =========================================================


-- BLOC 1 - Verification des prerequis (ne modifie rien)
do $$
begin
  if to_regclass('public.profils_publics') is null then
    raise exception 'Table profils_publics introuvable : executez d abord profils-publics.sql';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'Fonction is_admin() introuvable';
  end if;
  if to_regprocedure('gen_random_uuid()') is null then
    raise exception 'Fonction gen_random_uuid() introuvable';
  end if;
  if to_regclass('auth.users') is null then
    raise exception 'Table auth.users introuvable';
  end if;
  perform u.created_at from auth.users u limit 1;
end $$;


-- BLOC 2 - Table des codes : un code et un compteur par membre. RLS activee, AUCUNE politique,
-- aucun droit
create table if not exists public.invitations_codes (
  id bigint generated always as identity primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  code text not null unique,
  nb_inscrits integer not null default 0,
  cree_le timestamptz not null default now(),
  constraint invitations_codes_format check (
    char_length(code) = 10 and code = upper(code)
    and translate(code, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', '') = ''),
  constraint invitations_codes_borne check (nb_inscrits between 0 and 1000000)
);

alter table public.invitations_codes enable row level security;

revoke all on public.invitations_codes from public, anon, authenticated;


-- BLOC 3 - Comptes deja comptes : seulement le compte et un jour. AUCUNE colonne vers un code ou
-- un inviteur
create table if not exists public.invitations_comptes_comptes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  compte_le date not null default current_date
);

alter table public.invitations_comptes_comptes enable row level security;

revoke all on public.invitations_comptes_comptes from public, anon, authenticated;


-- BLOC 4 - Mon code : membre connecte, non anonyme, avec une page publiee et non suspendue
-- Cree le code s il n existe pas (50 bits aleatoires, nouvel essai en cas de collision). Ne renvoie que
-- le code et le nombre, pour ce membre uniquement. Aucune ligne si le membre n est pas eligible.
create or replace function public.invitation_mon_code()
 returns table (code text, nb_inscrits integer)
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_claims jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_u uuid;
  v_i integer;
  v_essai integer := 0;
begin
  if v_uid is null
     or coalesce((v_claims ->> 'is_anonymous')::boolean, false)
     or coalesce(v_claims -> 'app_metadata' ->> 'provider', '') = 'anonymous' then
    return;
  end if;
  if not exists (select 1 from public.profils_publics p
                  where p.user_id = v_uid and p.publie and not p.suspendu) then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('invm:' || v_uid::text, 0));
  if not exists (select 1 from public.invitations_codes c where c.user_id = v_uid) then
    loop
      v_essai := v_essai + 1;
      v_u := gen_random_uuid();
      v_code := '';
      foreach v_i in array array[0, 1, 2, 3, 4, 5, 7, 8, 9, 10] loop
        v_code := v_code || substr(v_alphabet, (get_byte(uuid_send(v_u), v_i) % 32) + 1, 1);
      end loop;
      begin
        insert into public.invitations_codes (user_id, code) values (v_uid, v_code);
        exit;
      exception when unique_violation then
        if v_essai >= 5 then
          raise exception 'Impossible de creer un code pour le moment';
        end if;
      end;
    end loop;
  end if;
  return query
  select c.code, c.nb_inscrits from public.invitations_codes c where c.user_id = v_uid;
end;
$$;


-- BLOC 5 - Enregistrer un code a l arrivee d un nouveau compte (renvoie TOUJOURS vrai)
-- Refus silencieux : format invalide, code inconnu, compte anonyme, proprietaire du code, compte
-- cree il y
-- a plus de 2 jours, compte deja compte. Le comptage et le compteur sont dans la meme transaction, sous
-- verrou. Rien ne relie le compte au code.
create or replace function public.invitation_enregistrer(p_code text)
 returns boolean
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_claims jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_proprio uuid;
  v_cree timestamptz;
  v_n integer;
begin
  if v_uid is null
     or coalesce((v_claims ->> 'is_anonymous')::boolean, false)
     or coalesce(v_claims -> 'app_metadata' ->> 'provider', '') = 'anonymous' then
    return true;
  end if;
  if p_code is null or char_length(p_code) <> 10 or p_code <> upper(p_code)
     or translate(p_code, v_alphabet, '') <> '' then
    return true;
  end if;
  select c.user_id into v_proprio from public.invitations_codes c where c.code = p_code;
  if not found or v_proprio = v_uid then
    return true;
  end if;
  select u.created_at into v_cree from auth.users u where u.id = v_uid;
  if v_cree is null or v_cree < now() - interval '2 days' then
    return true;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('invc:' || v_uid::text, 0));
  insert into public.invitations_comptes_comptes (user_id) values (v_uid)
  on conflict (user_id) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 1 then
    update public.invitations_codes c
       set nb_inscrits = least(c.nb_inscrits + 1, 1000000)
     where c.code = p_code;
  end if;
  return true;
end;
$$;


-- BLOC 6 - Administrateur : totaux anonymes (nombre de codes, total des inscrits, codes avec inscrits)
-- Aucune vue nominative. Refuse tout autre que les administrateurs.
create or replace function public.invitation_admin_totaux()
 returns table (nb_codes bigint, total_inscrits bigint, nb_codes_avec_inscrits bigint)
 language plpgsql
 stable
 security definer
 set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Reserve aux administrateurs' using errcode = '42501';
  end if;
  return query
  select count(*), coalesce(sum(c.nb_inscrits), 0)::bigint,
         count(*) filter (where c.nb_inscrits > 0)
    from public.invitations_codes c;
end;
$$;


-- BLOC 7 - Droits : rien pour le public ni pour anon, execution reservee aux membres connectes
-- La fonction administrateur verifie is_admin() elle-meme : un membre ordinaire est refuse.
revoke all on function public.invitation_mon_code() from public, anon;

revoke all on function public.invitation_enregistrer(text) from public, anon;

revoke all on function public.invitation_admin_totaux() from public, anon;

grant execute on function public.invitation_mon_code() to authenticated;

grant execute on function public.invitation_enregistrer(text) to authenticated;

grant execute on function public.invitation_admin_totaux() to authenticated;
