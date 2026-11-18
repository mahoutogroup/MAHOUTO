-- =========================================================
-- MAHOUTO+ — Institut SAYÉ LOUIS : demandes de parrainage, petits-fils, textes modifiables
--
-- 100 % ADDITIF : « create ... if not exists », « create or replace », « drop ... if exists » seulement sur
-- les objets créés ici. Aucune table existante n'est modifiée : RIEN sur public.purchases, public.messages,
-- public.rooms, public.profiles. RLS activée partout ; aucun accès anonyme en écriture.
--
-- ► À EXÉCUTER À LA MAIN dans Supabase (SQL Editor), d'abord sur un projet de TEST, BLOC PAR BLOC (copier
--   un bloc, l'exécuter, passer au suivant). Chaque bloc est court et se relance sans erreur.
-- ► Ce fichier n'est exécuté par aucun script du dépôt.
--
-- BLOCS (dans l'ordre) :
--   BLOC 1  — Vérification des prérequis (is_admin(), auth.users, stockage). Ne modifie rien.
--   BLOC 2  — Table institut_contenus (textes modifiables et interrupteur « ouvert »), RLS, droits.
--   BLOC 3  — Valeurs de départ : « ouvert » = non ; « histoire » = le texte actuel de la page.
--   BLOC 4  — Fonction institut_ouvert() (vrai si l'Institut est ouvert aux demandes).
--   BLOC 5  — Table institut_demandes (demandes de parrainage) : colonnes, contraintes, index.
--   BLOC 6  — institut_demandes : RLS, règles d'accès, droits (le parrain ne voit que les siennes).
--   BLOC 7  — institut_demandes : garde (traitement réservé aux admins, champs figés, 5 demandes en attente).
--   BLOC 8  — Table institut_petits_fils (marquage par un admin, un par un), RLS, droits.
--   BLOC 9  — Bucket de stockage PRIVÉ « institut-justificatifs » (5 Mo ; images et PDF).
--   BLOC 10 — Règles d'accès du bucket (storage.objects) : seulement ce bucket.
--
-- DONNÉES SENSIBLES : il s'agit souvent de mineurs. Une demande ne contient QUE le prénom, l'âge, le lien avec
-- le parrain, la formation, un motif facultatif et un justificatif facultatif. Jamais de nom de famille,
-- d'adresse, de téléphone ni de photo. Rien n'est lisible publiquement : seuls le parrain (ses propres lignes)
-- et les admins voient les demandes ; les justificatifs sont dans un bucket privé (URL signée de 60 s).
--
-- Retour arrière : institut-rollback.sql.  Vérification : institut-verification.sql.
-- =========================================================


-- BLOC 1 — Vérification des prérequis (ne modifie rien)
do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'public.is_admin() introuvable : exécute d''abord supabase-schema.sql';
  end if;
  if to_regclass('auth.users') is null then
    raise exception 'auth.users introuvable : ce script doit tourner sur un projet Supabase';
  end if;
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise exception 'Stockage Supabase introuvable (storage.buckets / storage.objects)';
  end if;
end $$;


-- BLOC 2 — Table institut_contenus (textes modifiables), RLS et droits
create table if not exists public.institut_contenus (
  cle text primary key,
  valeur text not null,
  maj_le timestamptz not null default now()
);

alter table public.institut_contenus drop constraint if exists institut_contenus_cle_check;
alter table public.institut_contenus
  add constraint institut_contenus_cle_check check (cle in ('histoire', 'ouvert'));

alter table public.institut_contenus drop constraint if exists institut_contenus_valeur_check;
alter table public.institut_contenus
  add constraint institut_contenus_valeur_check
  check (char_length(valeur) <= 5000 and (cle <> 'ouvert' or valeur in ('oui', 'non')));

create or replace function public.institut_contenus_maj()
 returns trigger
 language plpgsql
 set search_path = public, pg_temp
as $function$
begin
  new.maj_le := now();
  return new;
end;
$function$;

drop trigger if exists institut_contenus_maj_trg on public.institut_contenus;
create trigger institut_contenus_maj_trg
  before insert or update on public.institut_contenus
  for each row execute function public.institut_contenus_maj();

alter table public.institut_contenus enable row level security;

revoke all on public.institut_contenus from anon, authenticated;
grant select on public.institut_contenus to anon, authenticated;
grant insert, update, delete on public.institut_contenus to authenticated;   -- encadré par RLS : admin seulement

drop policy if exists "institut_contenus_public_read" on public.institut_contenus;
create policy "institut_contenus_public_read" on public.institut_contenus
  for select to anon, authenticated
  using (true);

drop policy if exists "institut_contenus_admin_insert" on public.institut_contenus;
create policy "institut_contenus_admin_insert" on public.institut_contenus
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "institut_contenus_admin_update" on public.institut_contenus;
create policy "institut_contenus_admin_update" on public.institut_contenus
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "institut_contenus_admin_delete" on public.institut_contenus;
create policy "institut_contenus_admin_delete" on public.institut_contenus
  for delete to authenticated
  using (public.is_admin());


-- BLOC 3 — Valeurs de départ (« do nothing » : relancer ne remplace jamais un texte modifié dans l'admin)
-- « histoire » = le texte actuel de la section « Notre histoire » d'institut.html (deux paragraphes).
insert into public.institut_contenus (cle, valeur) values
  ('ouvert', 'non'),
  ('histoire', E'L''Institut SAYÉ LOUIS a été créé par le fondateur de MAHOUTO+, Mahouto Abdallah, en mémoire de son père, Sayé Louis.\n\nTrès tôt, son père l''a orienté vers l''apprentissage. C''est cet héritage qui donne sa raison d''être à l''Institut : offrir aux orphelins l''accès à la formation, à un tarif très réduit.')
on conflict (cle) do nothing;


-- BLOC 4 — Fonction institut_ouvert() : vrai si institut_contenus.ouvert vaut 'oui'
-- security invoker suffit : la table est lisible par tous. search_path fixé.
create or replace function public.institut_ouvert()
 returns boolean
 language sql
 stable
 set search_path = public, pg_temp
as $function$
  select coalesce((select c.valeur = 'oui' from public.institut_contenus c where c.cle = 'ouvert'), false);
$function$;

revoke all on function public.institut_ouvert() from public;
grant execute on function public.institut_ouvert() to anon, authenticated;


-- BLOC 5 — Table institut_demandes (demandes de parrainage) : colonnes et contraintes
-- Volontairement : PAS de nom de famille, pas d'adresse, pas de téléphone, pas de photo.
create table if not exists public.institut_demandes (
  id uuid primary key default gen_random_uuid(),
  parrain_id uuid not null references auth.users(id) on delete cascade,
  prenom text not null,
  age integer not null,
  lien text not null,
  formation text not null,
  motif text not null default '',
  justificatif_path text,
  statut text not null default 'en_attente',
  raison_refus text,
  cree_le timestamptz not null default now(),
  traite_le timestamptz,
  traite_par uuid references auth.users(id) on delete set null
);

alter table public.institut_demandes drop constraint if exists institut_demandes_prenom_check;
alter table public.institut_demandes
  add constraint institut_demandes_prenom_check check (char_length(btrim(prenom)) between 1 and 40);

alter table public.institut_demandes drop constraint if exists institut_demandes_age_check;
alter table public.institut_demandes
  add constraint institut_demandes_age_check check (age between 3 and 35);

alter table public.institut_demandes drop constraint if exists institut_demandes_lien_check;
alter table public.institut_demandes
  add constraint institut_demandes_lien_check
  check (lien in ('parent', 'proche', 'tuteur', 'enseignant', 'lui_meme', 'autre'));

-- Règle métier : l'orphelin peut déposer la demande lui-même seulement s'il est majeur.
alter table public.institut_demandes drop constraint if exists institut_demandes_lui_meme_majeur_check;
alter table public.institut_demandes
  add constraint institut_demandes_lui_meme_majeur_check check (lien <> 'lui_meme' or age >= 18);

alter table public.institut_demandes drop constraint if exists institut_demandes_formation_check;
alter table public.institut_demandes
  add constraint institut_demandes_formation_check check (char_length(btrim(formation)) between 1 and 40);

alter table public.institut_demandes drop constraint if exists institut_demandes_motif_check;
alter table public.institut_demandes
  add constraint institut_demandes_motif_check check (char_length(motif) <= 500);

alter table public.institut_demandes drop constraint if exists institut_demandes_statut_check;
alter table public.institut_demandes
  add constraint institut_demandes_statut_check check (statut in ('en_attente', 'validee', 'refusee'));

alter table public.institut_demandes drop constraint if exists institut_demandes_raison_check;
alter table public.institut_demandes
  add constraint institut_demandes_raison_check
  check (raison_refus is null or (char_length(raison_refus) <= 300 and statut = 'refusee'));

-- Le justificatif doit être rangé dans <uid du parrain>/<id de la demande>/... : on ne peut pas viser le fichier d'un autre.
alter table public.institut_demandes drop constraint if exists institut_demandes_justificatif_check;
alter table public.institut_demandes
  add constraint institut_demandes_justificatif_check
  check (justificatif_path is null
         or (char_length(justificatif_path) <= 200
             and justificatif_path like parrain_id::text || '/' || id::text || '/%'
             and justificatif_path !~ '\.\.'));

-- Une demande en attente n'a ni date ni auteur de traitement ; une demande traitée a les deux.
alter table public.institut_demandes drop constraint if exists institut_demandes_traitement_check;
alter table public.institut_demandes
  add constraint institut_demandes_traitement_check check ((statut = 'en_attente') = (traite_le is null));

create index if not exists institut_demandes_parrain_idx on public.institut_demandes (parrain_id, cree_le desc);
create index if not exists institut_demandes_statut_idx on public.institut_demandes (statut, cree_le desc);


-- BLOC 6 — institut_demandes : RLS, règles d'accès et droits
alter table public.institut_demandes enable row level security;

revoke all on public.institut_demandes from anon, authenticated;
grant select on public.institut_demandes to authenticated;                       -- encadré par RLS
grant insert (id, parrain_id, prenom, age, lien, formation, motif, justificatif_path, statut)
  on public.institut_demandes to authenticated;                                  -- jamais traite_le / traite_par / raison_refus
grant update (statut, raison_refus) on public.institut_demandes to authenticated; -- encadré par RLS : admin seulement
-- Aucun droit de suppression : le parrain ne peut ni modifier ni supprimer ; les lignes disparaissent avec le compte.

drop policy if exists "institut_demandes_select" on public.institut_demandes;
create policy "institut_demandes_select" on public.institut_demandes
  for select to authenticated
  using (parrain_id = auth.uid() or public.is_admin());

-- Le parrain dépose une demande SEULEMENT pour lui-même, en attente, et seulement si l'Institut est ouvert
-- (un admin peut déposer avant l'ouverture, pour ses essais).
drop policy if exists "institut_demandes_insert_own" on public.institut_demandes;
create policy "institut_demandes_insert_own" on public.institut_demandes
  for insert to authenticated
  with check (
    parrain_id = auth.uid()
    and statut = 'en_attente'
    and (public.institut_ouvert() or public.is_admin())
  );

drop policy if exists "institut_demandes_admin_update" on public.institut_demandes;
create policy "institut_demandes_admin_update" on public.institut_demandes
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- BLOC 7 — institut_demandes : garde (champs figés, traitement réservé aux admins, 5 demandes en attente au plus)
create or replace function public.institut_demandes_garde()
 returns trigger
 language plpgsql
 set search_path = public, pg_temp
as $function$
declare
  v_serveur boolean := (auth.uid() is null) or (coalesce(auth.role(), '') = 'service_role');
  v_en_attente integer;
begin
  if tg_op = 'INSERT' then
    -- Une nouvelle demande est toujours « en attente », sans trace de traitement.
    new.statut := 'en_attente';
    new.raison_refus := null;
    new.traite_le := null;
    new.traite_par := null;
    -- Limite anti-abus : 5 demandes en attente au plus par parrain (verrou par parrain contre les envois simultanés).
    perform pg_advisory_xact_lock(hashtextextended(new.parrain_id::text, 0));
    select count(*) into v_en_attente
      from public.institut_demandes d
     where d.parrain_id = new.parrain_id and d.statut = 'en_attente';
    if v_en_attente >= 5 then
      raise exception 'Vous avez déjà 5 demandes en attente. Patientez jusqu''à leur examen avant d''en déposer une nouvelle.';
    end if;
    return new;
  end if;

  -- UPDATE : les informations déposées ne changent plus jamais (sauf depuis le serveur / l'éditeur SQL).
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
      raise exception 'Les informations d''une demande ne peuvent plus être modifiées.';
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
$function$;

drop trigger if exists institut_demandes_garde_trg on public.institut_demandes;
create trigger institut_demandes_garde_trg
  before insert or update on public.institut_demandes
  for each row execute function public.institut_demandes_garde();


-- BLOC 8 — Table institut_petits_fils (marquage PAR UN ADMIN, un par un : jamais d'auto-déclaration)
create table if not exists public.institut_petits_fils (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ajoute_par uuid default auth.uid() references auth.users(id) on delete set null,
  ajoute_le timestamptz not null default now()
);

alter table public.institut_petits_fils enable row level security;

revoke all on public.institut_petits_fils from anon, authenticated;
grant select, delete on public.institut_petits_fils to authenticated;            -- encadré par RLS
grant insert (user_id, ajoute_par) on public.institut_petits_fils to authenticated;
grant update (ajoute_par) on public.institut_petits_fils to authenticated;

drop policy if exists "institut_petits_fils_select" on public.institut_petits_fils;
create policy "institut_petits_fils_select" on public.institut_petits_fils
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "institut_petits_fils_admin_insert" on public.institut_petits_fils;
create policy "institut_petits_fils_admin_insert" on public.institut_petits_fils
  for insert to authenticated
  with check (public.is_admin() and (ajoute_par is null or ajoute_par = auth.uid()));

drop policy if exists "institut_petits_fils_admin_update" on public.institut_petits_fils;
create policy "institut_petits_fils_admin_update" on public.institut_petits_fils
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "institut_petits_fils_admin_delete" on public.institut_petits_fils;
create policy "institut_petits_fils_admin_delete" on public.institut_petits_fils
  for delete to authenticated
  using (public.is_admin());


-- BLOC 9 — Bucket de stockage PRIVÉ « institut-justificatifs » (5 Mo, images et PDF)
-- « do nothing » : si le bucket existe déjà, ses réglages ne sont pas modifiés (vérifiez-les avec institut-verification.sql).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'institut-justificatifs', 'institut-justificatifs', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;


-- BLOC 10 — Règles d'accès aux fichiers du bucket (ce bucket SEULEMENT)
-- Chemin attendu : <uid>/<id_demande>/<nom aléatoire>.<ext>. Aucune règle de modification : personne ne remplace un fichier.
drop policy if exists "institut_justificatifs_insert_own" on storage.objects;
create policy "institut_justificatifs_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'institut-justificatifs'
    and (storage.foldername(name))[1] = auth.uid()::text
    and array_length(storage.foldername(name), 1) = 2
  );

drop policy if exists "institut_justificatifs_select" on storage.objects;
create policy "institut_justificatifs_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'institut-justificatifs'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

drop policy if exists "institut_justificatifs_admin_delete" on storage.objects;
create policy "institut_justificatifs_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'institut-justificatifs' and public.is_admin());
