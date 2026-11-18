-- =========================================================
-- MAHOUTO+ — Institut SAYÉ LOUIS : catalogue des formations, dons, places, codes d'invitation (PR 3)
--
-- 100 % ADDITIF : aucune table existante n'est modifiée (ni public.formations, ni public.purchases, ni messages,
-- rooms, profiles, ni les tables de l'Institut des PR 1 et 2). RLS activée partout ; aucun accès anonyme en écriture.
-- Les places ne s'écrivent QUE par les fonctions ci-dessous (aucun droit d'insertion, de modification ou de
-- suppression direct sur institut_places, même pour les admins).
--
-- ► À EXÉCUTER À LA MAIN dans Supabase (SQL Editor), d'abord sur un projet de TEST, BLOC PAR BLOC : copier un bloc,
--   l'exécuter, passer au suivant. Chaque bloc est court, autonome et se relance sans erreur. Les commentaires
--   sont placés AVANT les instructions (jamais au milieu), pour résister à un collage déformé.
-- ► Prérequis : institut.sql (PR 2) déjà exécuté.
--
-- BLOCS (dans l'ordre) :
--   BLOC 1  — Vérification des prérequis. Ne modifie rien.
--   BLOC 2  — Table institut_formations (formations de l'Académie proposées à l'Institut, avec « prix Institut »).
--   BLOC 3  — institut_formations : RLS et droits (lecture publique des actives ; les admins lisent et écrivent).
--   BLOC 4  — Fonction institut_formations_maj() et son déclencheur (date de mise à jour).
--   BLOC 5  — Table institut_dons (dons enregistrés à la main) : RLS et droits, admins seuls.
--   BLOC 6  — Table institut_places (une place par demande validée, avec son code d'invitation).
--   BLOC 7  — institut_places : RLS et droits (lecture seule : admins, parrain, bénéficiaire).
--   BLOC 8  — Fonction institut_dons_garde() et son déclencheur (un don ne peut pas passer sous ses places utilisées).
--   BLOC 9  — Table institut_tentatives (échecs de saisie de code : limite anti-devinette). Aucun accès direct.
--   BLOC 10 — Fonction institut_code_genere() (code de 8 caractères, interne, jamais appelable de l'extérieur).
--   BLOC 11 — Fonction institut_attribuer_place() (admins seulement).
--   BLOC 12 — Fonction institut_reclamer_place() (utilisateur connecté : ouvre l'accès à la formation).
--   BLOC 13 — Fonction institut_stats() (deux nombres publics, sans aucun nom).
--
-- CHOIX DOCUMENTÉS
--   • Statistiques : « places_financees » = nombre de places ATTRIBUÉES et rattachées à un don (pas la capacité des
--     dons : on ne compte que ce qui est réellement attribué) ; « eleves_formes » = nombre de places RÉCLAMÉES
--     (don ou offerte). Jamais de nom, de montant ni d'identifiant.
--   • Code d'invitation : 8 caractères de l'alphabet ABCDEFGHJKLMNPQRSTUVWXYZ23456789 (32 symboles, 5 bits chacun,
--     40 bits au total), tirés de gen_random_uuid() (aléatoire cryptographique de PostgreSQL), jamais de random().
--   • Échecs de saisie : une exception annule toute la transaction, y compris l'enregistrement de la tentative. Pour que
--     la limite fonctionne, institut_reclamer_place() NE LÈVE PAS d'exception pour un échec de saisie : elle enregistre
--     la tentative puis RENVOIE un texte « ERREUR:<CODE> » (le succès renvoie l'identifiant de la formation). Une
--     exception n'est levée que pour un utilisateur non connecté (rien à enregistrer).
--   • Un code inconnu, mal formé ou déjà réclamé donne la MÊME réponse (ERREUR:CODE_INVALIDE) : aucun indice sur les
--     codes qui existent. Ces trois cas comptent comme échecs : 5 au plus par heure et par utilisateur.
--   • La réclamation crée UNE ligne public.purchases (montant 0, statut « paid », type « formation », sans transaction
--     FedaPay). Aucune contrainte de purchases ne bloque cette insertion (voir le rapport de la PR). Ces lignes RESTENT
--     si on exécute le retour arrière : l'élève garde son accès.
--   • Le parrain ne peut pas réclamer sa propre place (sauf si l'orphelin dépose la demande lui-même, lien « lui_meme »).
--   • Si une demande n'est plus « validée » (repassée en attente ou refusée après l'attribution), son code cesse de
--     fonctionner (même réponse neutre) tant qu'elle n'est pas de nouveau validée.
--
-- Retour arrière : institut-places-rollback.sql.  Vérification : institut-places-verification.sql.
-- =========================================================


-- BLOC 1 — Vérification des prérequis (ne modifie rien)
do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'public.is_admin() introuvable : exécute d''abord supabase-schema.sql';
  end if;
  if to_regclass('public.formations') is null or to_regclass('public.purchases') is null then
    raise exception 'public.formations ou public.purchases introuvable : exécute d''abord supabase-schema.sql';
  end if;
  if to_regclass('public.institut_demandes') is null or to_regclass('public.institut_contenus') is null then
    raise exception 'Tables de l''Institut introuvables : exécute d''abord institut.sql (PR 2)';
  end if;
  if to_regprocedure('gen_random_uuid()') is null or to_regprocedure('uuid_send(uuid)') is null then
    raise exception 'gen_random_uuid() ou uuid_send() introuvable : PostgreSQL 13 ou plus est requis';
  end if;
end $$;


-- BLOC 2 — Table institut_formations
create table if not exists public.institut_formations (
  formation_id text primary key references public.formations(id) on delete cascade,
  prix_institut integer not null,
  actif boolean not null default false,
  ordre integer not null default 0,
  maj_le timestamptz not null default now()
);

alter table public.institut_formations drop constraint if exists institut_formations_prix_check;
alter table public.institut_formations
  add constraint institut_formations_prix_check check (prix_institut > 0);


-- BLOC 3 — institut_formations : RLS et droits
alter table public.institut_formations enable row level security;

revoke all on public.institut_formations from anon, authenticated;
grant select on public.institut_formations to anon, authenticated;
grant insert (formation_id, prix_institut, actif, ordre) on public.institut_formations to authenticated;
grant update (prix_institut, actif, ordre) on public.institut_formations to authenticated;
grant delete on public.institut_formations to authenticated;

drop policy if exists "institut_formations_public_read" on public.institut_formations;
create policy "institut_formations_public_read" on public.institut_formations
  for select to anon, authenticated
  using (actif = true);

drop policy if exists "institut_formations_admin_select" on public.institut_formations;
create policy "institut_formations_admin_select" on public.institut_formations
  for select to authenticated
  using (public.is_admin());

drop policy if exists "institut_formations_admin_insert" on public.institut_formations;
create policy "institut_formations_admin_insert" on public.institut_formations
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "institut_formations_admin_update" on public.institut_formations;
create policy "institut_formations_admin_update" on public.institut_formations
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "institut_formations_admin_delete" on public.institut_formations;
create policy "institut_formations_admin_delete" on public.institut_formations
  for delete to authenticated
  using (public.is_admin());


-- BLOC 4 — Fonction institut_formations_maj() et son déclencheur
create or replace function public.institut_formations_maj()
 returns trigger
 language plpgsql
 set search_path = public, pg_temp
as $function$
begin
  new.maj_le := now();
  return new;
end;
$function$;

drop trigger if exists institut_formations_maj_trg on public.institut_formations;
create trigger institut_formations_maj_trg
  before insert or update on public.institut_formations
  for each row execute function public.institut_formations_maj();


-- BLOC 5 — Table institut_dons (dons enregistrés à la main) : admins seuls
create table if not exists public.institut_dons (
  id uuid primary key default gen_random_uuid(),
  montant integer not null,
  places integer not null,
  donateur text,
  note text,
  recu_le date not null default current_date,
  cree_par uuid default auth.uid() references auth.users(id) on delete set null,
  cree_le timestamptz not null default now()
);

alter table public.institut_dons drop constraint if exists institut_dons_montant_check;
alter table public.institut_dons add constraint institut_dons_montant_check check (montant > 0);
alter table public.institut_dons drop constraint if exists institut_dons_places_check;
alter table public.institut_dons add constraint institut_dons_places_check check (places between 1 and 1000);
alter table public.institut_dons drop constraint if exists institut_dons_donateur_check;
alter table public.institut_dons add constraint institut_dons_donateur_check check (donateur is null or char_length(donateur) <= 80);
alter table public.institut_dons drop constraint if exists institut_dons_note_check;
alter table public.institut_dons add constraint institut_dons_note_check check (note is null or char_length(note) <= 300);

alter table public.institut_dons enable row level security;
revoke all on public.institut_dons from anon, authenticated;
grant select, delete on public.institut_dons to authenticated;
grant insert (montant, places, donateur, note, recu_le) on public.institut_dons to authenticated;
grant update (montant, places, donateur, note, recu_le) on public.institut_dons to authenticated;

drop policy if exists "institut_dons_admin_select" on public.institut_dons;
create policy "institut_dons_admin_select" on public.institut_dons
  for select to authenticated using (public.is_admin());

drop policy if exists "institut_dons_admin_insert" on public.institut_dons;
create policy "institut_dons_admin_insert" on public.institut_dons
  for insert to authenticated with check (public.is_admin());

drop policy if exists "institut_dons_admin_update" on public.institut_dons;
create policy "institut_dons_admin_update" on public.institut_dons
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "institut_dons_admin_delete" on public.institut_dons;
create policy "institut_dons_admin_delete" on public.institut_dons
  for delete to authenticated using (public.is_admin());


-- BLOC 6 — Table institut_places (une place par demande validée)
create table if not exists public.institut_places (
  id uuid primary key default gen_random_uuid(),
  demande_id uuid not null unique references public.institut_demandes(id) on delete cascade,
  formation_id text not null references public.institut_formations(formation_id),
  source text not null,
  don_id uuid references public.institut_dons(id) on delete restrict,
  code text not null unique,
  beneficiaire_id uuid references auth.users(id) on delete set null,
  reclamee_le timestamptz,
  cree_par uuid default auth.uid() references auth.users(id) on delete set null,
  cree_le timestamptz not null default now()
);

alter table public.institut_places drop constraint if exists institut_places_source_check;
alter table public.institut_places add constraint institut_places_source_check check (source in ('don', 'offerte'));
alter table public.institut_places drop constraint if exists institut_places_don_check;
alter table public.institut_places
  add constraint institut_places_don_check
  check ((source = 'don' and don_id is not null) or (source = 'offerte' and don_id is null));
alter table public.institut_places drop constraint if exists institut_places_reclamee_check;
alter table public.institut_places
  add constraint institut_places_reclamee_check check ((beneficiaire_id is null) = (reclamee_le is null));
alter table public.institut_places drop constraint if exists institut_places_code_check;
alter table public.institut_places
  add constraint institut_places_code_check check (code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$');

create index if not exists institut_places_don_idx on public.institut_places (don_id);
create index if not exists institut_places_beneficiaire_idx on public.institut_places (beneficiaire_id);


-- BLOC 7 — institut_places : RLS et droits (lecture seule ; tout le reste passe par les fonctions)
alter table public.institut_places enable row level security;

revoke all on public.institut_places from anon, authenticated;
grant select on public.institut_places to authenticated;

drop policy if exists "institut_places_admin_select" on public.institut_places;
create policy "institut_places_admin_select" on public.institut_places
  for select to authenticated using (public.is_admin());

drop policy if exists "institut_places_parrain_select" on public.institut_places;
create policy "institut_places_parrain_select" on public.institut_places
  for select to authenticated
  using (exists (select 1 from public.institut_demandes d where d.id = demande_id and d.parrain_id = auth.uid()));

drop policy if exists "institut_places_beneficiaire_select" on public.institut_places;
create policy "institut_places_beneficiaire_select" on public.institut_places
  for select to authenticated using (beneficiaire_id = auth.uid());


-- BLOC 8 — Fonction institut_dons_garde() : un don ne peut pas descendre sous les places déjà utilisées
create or replace function public.institut_dons_garde()
 returns trigger
 language plpgsql
 set search_path = public, pg_temp
as $function$
declare
  v_utilisees integer;
begin
  select count(*) into v_utilisees from public.institut_places where don_id = old.id;
  if new.places < v_utilisees then
    raise exception 'Ce don a déjà % place(s) attribuée(s) : il ne peut pas en financer moins.', v_utilisees;
  end if;
  return new;
end;
$function$;

drop trigger if exists institut_dons_garde_trg on public.institut_dons;
create trigger institut_dons_garde_trg
  before update of places on public.institut_dons
  for each row execute function public.institut_dons_garde();


-- BLOC 9 — Table institut_tentatives (échecs de saisie de code) : RLS activée, AUCUNE règle, aucun droit
create table if not exists public.institut_tentatives (
  user_id uuid not null references auth.users(id) on delete cascade,
  cree_le timestamptz not null default now()
);

create index if not exists institut_tentatives_user_idx on public.institut_tentatives (user_id, cree_le desc);

alter table public.institut_tentatives enable row level security;
revoke all on public.institut_tentatives from anon, authenticated;


-- BLOC 10 — Fonction institut_code_genere() : 8 caractères, interne
create or replace function public.institut_code_genere()
 returns text
 language plpgsql
 volatile
 set search_path = public, pg_temp
as $function$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_octets bytea := uuid_send(gen_random_uuid());
  v_positions constant integer[] := array[0, 1, 2, 3, 4, 5, 7, 9];
  v_code text := '';
  i integer;
begin
  foreach i in array v_positions loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_octets, i) & 31) + 1, 1);
  end loop;
  return v_code;
end;
$function$;

revoke all on function public.institut_code_genere() from public, anon, authenticated;


-- BLOC 11 — Fonction institut_attribuer_place() : réservée aux admins
create or replace function public.institut_attribuer_place(p_demande uuid, p_formation text, p_source text, p_don uuid default null)
 returns uuid
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $function$
declare
  v_demande public.institut_demandes%rowtype;
  v_don public.institut_dons%rowtype;
  v_utilisees integer;
  v_essai integer := 0;
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs.';
  end if;
  if p_source is null or p_source not in ('don', 'offerte') then
    raise exception 'Financement invalide : choisissez « don » ou « offerte ».';
  end if;
  select * into v_demande from public.institut_demandes where id = p_demande for update;
  if not found then
    raise exception 'Demande introuvable.';
  end if;
  if v_demande.statut <> 'validee' then
    raise exception 'La demande doit d''abord être validée.';
  end if;
  if exists (select 1 from public.institut_places where demande_id = p_demande) then
    raise exception 'Cette demande a déjà une place.';
  end if;
  if not exists (select 1 from public.institut_formations where formation_id = p_formation and actif) then
    raise exception 'Cette formation n''est pas proposée par l''Institut.';
  end if;
  if p_source = 'offerte' and p_don is not null then
    raise exception 'Une place offerte ne se rattache à aucun don.';
  end if;
  if p_source = 'don' then
    if p_don is null then
      raise exception 'Choisissez le don qui finance cette place.';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(p_don::text, 0));
    select * into v_don from public.institut_dons where id = p_don;
    if not found then
      raise exception 'Don introuvable.';
    end if;
    select count(*) into v_utilisees from public.institut_places where don_id = p_don;
    if v_utilisees >= v_don.places then
      raise exception 'Ce don n''a plus de place disponible.';
    end if;
  end if;
  loop
    v_essai := v_essai + 1;
    begin
      insert into public.institut_places (demande_id, formation_id, source, don_id, code)
      values (p_demande, p_formation, p_source, case when p_source = 'don' then p_don else null end, public.institut_code_genere())
      returning id into v_id;
      exit;
    exception when unique_violation then
      if v_essai >= 10 then
        raise exception 'Impossible de générer un code unique. Réessayez dans un instant.';
      end if;
    end;
  end loop;
  return v_id;
end;
$function$;

revoke all on function public.institut_attribuer_place(uuid, text, text, uuid) from public, anon;
grant execute on function public.institut_attribuer_place(uuid, text, text, uuid) to authenticated;


-- BLOC 12 — Fonction institut_reclamer_place() : renvoie l'id de la formation, ou « ERREUR:<CODE> »
create or replace function public.institut_reclamer_place(p_code text)
 returns text
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_place public.institut_places%rowtype;
  v_parrain uuid;
  v_lien text;
  v_statut text;
  v_nom text;
begin
  if v_uid is null then
    raise exception 'Connectez-vous pour utiliser un code d''invitation.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('institut_tentatives:' || v_uid::text, 0));
  delete from public.institut_tentatives where cree_le < now() - interval '1 day';
  if (select count(*) from public.institut_tentatives where user_id = v_uid and cree_le > now() - interval '1 hour') >= 5 then
    return 'ERREUR:TROP_DE_TENTATIVES';
  end if;
  v_code := upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g'));
  if v_code !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$' then
    insert into public.institut_tentatives (user_id) values (v_uid);
    return 'ERREUR:CODE_INVALIDE';
  end if;
  select * into v_place from public.institut_places where code = v_code for update;
  if not found or v_place.reclamee_le is not null then
    insert into public.institut_tentatives (user_id) values (v_uid);
    return 'ERREUR:CODE_INVALIDE';
  end if;
  select d.parrain_id, d.lien, d.statut into v_parrain, v_lien, v_statut from public.institut_demandes d where d.id = v_place.demande_id;
  if v_statut is distinct from 'validee' then
    insert into public.institut_tentatives (user_id) values (v_uid);
    return 'ERREUR:CODE_INVALIDE';
  end if;
  if v_parrain = v_uid and v_lien <> 'lui_meme' then
    return 'ERREUR:PARRAIN';
  end if;
  if exists (select 1 from public.purchases p where p.user_id = v_uid and p.course_id = v_place.formation_id and p.product_type = 'formation' and p.status = 'paid') then
    return 'ERREUR:DEJA_POSSEDEE';
  end if;
  select f.nom into v_nom from public.formations f where f.id = v_place.formation_id;
  begin
    update public.institut_places set beneficiaire_id = v_uid, reclamee_le = now() where id = v_place.id;
    insert into public.purchases (user_id, course_id, course_name, amount, status, product_type, paid_at, fedapay_transaction_id)
    values (v_uid, v_place.formation_id, coalesce(v_nom, v_place.formation_id), 0, 'paid', 'formation', now(), null);
  exception when unique_violation then
    return 'ERREUR:ACHAT_EXISTANT';
  end;
  return v_place.formation_id;
end;
$function$;

revoke all on function public.institut_reclamer_place(text) from public, anon;
grant execute on function public.institut_reclamer_place(text) to authenticated;


-- BLOC 13 — Fonction institut_stats() : deux nombres publics, sans aucun nom ni identifiant
create or replace function public.institut_stats()
 returns table (places_financees integer, eleves_formes integer)
 language sql
 stable
 security definer
 set search_path = public, pg_temp
as $function$
  select
    (select count(*)::integer from public.institut_places where source = 'don'),
    (select count(*)::integer from public.institut_places where reclamee_le is not null);
$function$;

revoke all on function public.institut_stats() from public;
grant execute on function public.institut_stats() to anon, authenticated;
