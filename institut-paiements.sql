-- =========================================================
-- MAHOUTO+ — Institut SAYÉ LOUIS : paiement du prix social avec FedaPay (PR 4)
--
-- Deux cas de paiement (le montant est TOUJOURS relu en base par le serveur : institut_formations.prix_institut) :
--   A) « parrain »    : le parrain paie la place d'un élève dont la demande est validée et sans place. La
--                       confirmation CRÉE la place (source « payee ») avec son code d'invitation.
--   B) « petit_fils » : un petit-fils marqué par un admin paie lui-même une formation du catalogue actif. La
--                       confirmation crée directement l'accès (ligne public.purchases, montant = prix, « paid »).
--
-- ADDITIF : une seule table existante est modifiée, public.institut_places (2 contraintes élargies pour accepter la
-- source « payee »). Rien sur public.formations, public.purchases (lecture et insertion par la fonction seulement),
-- messages, rooms, profiles, ni sur les autres tables de l'Institut. RLS activée ; aucun accès anonyme.
-- institut_paiements n'a AUCUN droit d'écriture direct : tout passe par les fonctions, appelées par le serveur
-- (api/_institut-paiement.js, clé service_role) APRÈS la vérification de la signature et la relecture de la
-- transaction chez FedaPay.
--
-- ► À EXÉCUTER À LA MAIN dans Supabase (SQL Editor), d'abord sur un projet de TEST, BLOC PAR BLOC : copier un bloc,
--   l'exécuter, passer au suivant. Chaque bloc est court, autonome et se relance sans erreur. Les commentaires sont
--   placés AVANT les instructions (jamais au milieu), pour résister à un collage déformé.
-- ► Prérequis : institut.sql (PR 2) et institut-places.sql (PR 3) déjà exécutés.
-- ► ORDRE : exécuter ce fichier AVANT de déployer le code de la PR 4.
--
-- BLOCS (dans l'ordre) :
--   BLOC 1 — Vérification des prérequis. Ne modifie rien.
--   BLOC 2 — institut_places : accepter la source « payee » (cohérence avec don_id conservée).
--   BLOC 3 — Table institut_paiements (un paiement FedaPay par ligne) : colonnes, contraintes, index.
--   BLOC 4 — institut_paiements : RLS et droits (lecture : le payeur et les admins ; aucune écriture directe).
--   BLOC 5 — Fonction interne institut_paiement_place() : crée la place du cas « parrain ».
--   BLOC 6 — Fonction interne institut_paiement_acces() : crée l'accès du cas « petit_fils » (ligne purchases).
--   BLOC 7 — Fonction institut_confirmer_paiement() : confirmation atomique et idempotente (service_role seul).
--   BLOC 8 — Fonction institut_echouer_paiement() : paiement refusé ou annulé (service_role seul).
--
-- CHOIX DOCUMENTÉS
--   • Montant : institut_paiements.montant est l'INSTANTANÉ du prix lu en base AU MOMENT de la création de la
--     transaction. À la confirmation, le montant officiel relu chez FedaPay doit lui être égal, sinon le paiement
--     passe à « echoue » (note « montant_incoherent ») et RIEN n'est créé. Si l'admin change le prix entre le
--     paiement et la confirmation, le payeur reste honoré au prix qu'il a payé.
--   • Idempotence : la ligne du paiement est verrouillée (for update) ; seul un paiement « en_attente » peut passer à
--     « paye » ; un second appel pour la même transaction ne crée RIEN. Cas « petit_fils » : l'identifiant de la
--     transaction est aussi enregistré dans purchases (colonne déjà unique).
--   • Anomalie après un paiement réel (demande plus validée, place déjà attribuée entre-temps, formation déjà
--     possédée, achat existant) : le paiement est marqué « paye » avec une NOTE (colonne note) et rien n'est créé ;
--     l'administrateur le voit dans l'onglet « Paiements » et traite à la main (remboursement ou attribution).
--     Une erreur technique (exception) annule toute la transaction : le webhook répond 5xx et FedaPay réessaie.
--   • Si la place ou l'achat existe déjà, l'accès n'est jamais doublé.
--
-- Retour arrière : institut-paiements-rollback.sql.  Vérification : institut-paiements-verification.sql.
-- =========================================================


-- BLOC 1 — Vérification des prérequis (ne modifie rien)
do $$
begin
  if to_regclass('public.institut_places') is null or to_regclass('public.institut_formations') is null
     or to_regclass('public.institut_petits_fils') is null or to_regclass('public.institut_demandes') is null then
    raise exception 'Tables de l''Institut introuvables : exécute d''abord institut.sql (PR 2) et institut-places.sql (PR 3)';
  end if;
  if to_regprocedure('public.institut_code_genere()') is null then
    raise exception 'public.institut_code_genere() introuvable : exécute d''abord institut-places.sql (PR 3)';
  end if;
  if to_regclass('public.purchases') is null or to_regclass('public.formations') is null then
    raise exception 'public.purchases ou public.formations introuvable : exécute d''abord supabase-schema.sql';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'public.is_admin() introuvable : exécute d''abord supabase-schema.sql';
  end if;
end $$;


-- BLOC 2 — institut_places : la source « payee » est acceptée (sans don), comme « offerte »
alter table public.institut_places drop constraint if exists institut_places_source_check;
alter table public.institut_places
  add constraint institut_places_source_check check (source in ('don', 'offerte', 'payee'));

alter table public.institut_places drop constraint if exists institut_places_don_check;
alter table public.institut_places
  add constraint institut_places_don_check
  check ((source = 'don' and don_id is not null) or (source in ('offerte', 'payee') and don_id is null));


-- BLOC 3 — Table institut_paiements
create table if not exists public.institut_paiements (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  user_id uuid references auth.users(id) on delete set null,
  demande_id uuid references public.institut_demandes(id) on delete set null,
  formation_id text not null references public.institut_formations(formation_id),
  montant integer not null,
  fedapay_transaction_id text not null unique,
  statut text not null default 'en_attente',
  note text,
  place_id uuid references public.institut_places(id) on delete set null,
  cree_le timestamptz not null default now(),
  confirme_le timestamptz
);

alter table public.institut_paiements drop constraint if exists institut_paiements_type_check;
alter table public.institut_paiements
  add constraint institut_paiements_type_check check (type in ('parrain', 'petit_fils'));

alter table public.institut_paiements drop constraint if exists institut_paiements_demande_check;
alter table public.institut_paiements
  add constraint institut_paiements_demande_check check (type = 'parrain' or demande_id is null);

alter table public.institut_paiements drop constraint if exists institut_paiements_montant_check;
alter table public.institut_paiements
  add constraint institut_paiements_montant_check check (montant > 0);

alter table public.institut_paiements drop constraint if exists institut_paiements_statut_check;
alter table public.institut_paiements
  add constraint institut_paiements_statut_check check (statut in ('en_attente', 'paye', 'echoue'));

alter table public.institut_paiements drop constraint if exists institut_paiements_note_check;
alter table public.institut_paiements
  add constraint institut_paiements_note_check check (note is null or char_length(note) <= 200);

alter table public.institut_paiements drop constraint if exists institut_paiements_confirme_check;
alter table public.institut_paiements
  add constraint institut_paiements_confirme_check check ((statut = 'paye') = (confirme_le is not null));

create index if not exists institut_paiements_user_idx on public.institut_paiements (user_id, cree_le desc);
create index if not exists institut_paiements_demande_idx on public.institut_paiements (demande_id);


-- BLOC 4 — institut_paiements : RLS et droits (lecture seule ; l'écriture passe par le serveur et les fonctions)
alter table public.institut_paiements enable row level security;

revoke all on public.institut_paiements from anon, authenticated;
grant select on public.institut_paiements to authenticated;

drop policy if exists "institut_paiements_payeur_select" on public.institut_paiements;
create policy "institut_paiements_payeur_select" on public.institut_paiements
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "institut_paiements_admin_select" on public.institut_paiements;
create policy "institut_paiements_admin_select" on public.institut_paiements
  for select to authenticated using (public.is_admin());


-- BLOC 5 — Fonction interne institut_paiement_place() : cas « parrain » (crée la place payée et son code)
create or replace function public.institut_paiement_place(p_paiement uuid)
 returns text
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $function$
declare
  v_p public.institut_paiements%rowtype;
  v_demande public.institut_demandes%rowtype;
  v_place uuid;
  v_essai integer := 0;
begin
  select * into v_p from public.institut_paiements where id = p_paiement;
  select * into v_demande from public.institut_demandes where id = v_p.demande_id for update;
  if not found or v_demande.statut <> 'validee' then
    return 'demande_non_validee';
  end if;
  if exists (select 1 from public.institut_places where demande_id = v_p.demande_id) then
    return 'place_deja_existante';
  end if;
  loop
    v_essai := v_essai + 1;
    begin
      insert into public.institut_places (demande_id, formation_id, source, don_id, code, cree_par)
      values (v_p.demande_id, v_p.formation_id, 'payee', null, public.institut_code_genere(), v_p.user_id)
      returning id into v_place;
      exit;
    exception when unique_violation then
      if v_essai >= 10 then
        raise exception 'Impossible de générer un code unique.';
      end if;
    end;
  end loop;
  update public.institut_paiements set place_id = v_place where id = v_p.id;
  return 'ok';
end;
$function$;

revoke all on function public.institut_paiement_place(uuid) from public, anon, authenticated;


-- BLOC 6 — Fonction interne institut_paiement_acces() : cas « petit_fils » (crée l'accès : ligne purchases payée)
create or replace function public.institut_paiement_acces(p_paiement uuid)
 returns text
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $function$
declare
  v_p public.institut_paiements%rowtype;
  v_nom text;
begin
  select * into v_p from public.institut_paiements where id = p_paiement;
  if v_p.user_id is null then
    return 'payeur_inconnu';
  end if;
  if exists (select 1 from public.purchases x where x.user_id = v_p.user_id and x.course_id = v_p.formation_id and x.product_type = 'formation' and x.status = 'paid') then
    return 'deja_possedee';
  end if;
  select f.nom into v_nom from public.formations f where f.id = v_p.formation_id;
  begin
    insert into public.purchases (user_id, course_id, course_name, amount, status, product_type, paid_at, fedapay_transaction_id, fedapay_status)
    values (v_p.user_id, v_p.formation_id, coalesce(v_nom, v_p.formation_id), v_p.montant, 'paid', 'formation', now(), v_p.fedapay_transaction_id, 'approved');
  exception when unique_violation then
    return 'achat_existant';
  end;
  return 'ok';
end;
$function$;

revoke all on function public.institut_paiement_acces(uuid) from public, anon, authenticated;


-- BLOC 7 — Fonction institut_confirmer_paiement() : confirmation atomique et idempotente (service_role seul)
create or replace function public.institut_confirmer_paiement(p_transaction_id text, p_montant integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $function$
declare
  v public.institut_paiements%rowtype;
  v_res text;
begin
  if auth.uid() is not null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Réservé au serveur';
  end if;
  select * into v from public.institut_paiements where fedapay_transaction_id = p_transaction_id for update;
  if not found then
    return jsonb_build_object('resultat', 'introuvable');
  end if;
  if v.statut = 'paye' then
    return jsonb_build_object('resultat', 'deja_confirme');
  end if;
  if v.statut <> 'en_attente' then
    return jsonb_build_object('resultat', 'ignore', 'statut', v.statut);
  end if;
  if p_montant is null or v.montant <> p_montant then
    update public.institut_paiements set statut = 'echoue', note = 'montant_incoherent' where id = v.id;
    return jsonb_build_object('resultat', 'montant_incoherent');
  end if;
  if v.type = 'parrain' then
    v_res := public.institut_paiement_place(v.id);
  else
    v_res := public.institut_paiement_acces(v.id);
  end if;
  update public.institut_paiements
     set statut = 'paye', confirme_le = now(), note = case when v_res = 'ok' then null else v_res end
   where id = v.id;
  return jsonb_build_object('resultat', 'confirme', 'type', v.type, 'anomalie', case when v_res = 'ok' then null else v_res end);
end;
$function$;

revoke all on function public.institut_confirmer_paiement(text, integer) from public, anon, authenticated;
grant execute on function public.institut_confirmer_paiement(text, integer) to service_role;


-- BLOC 8 — Fonction institut_echouer_paiement() : paiement refusé ou annulé chez FedaPay (service_role seul)
create or replace function public.institut_echouer_paiement(p_transaction_id text)
 returns boolean
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $function$
declare
  v_n integer;
begin
  if auth.uid() is not null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Réservé au serveur';
  end if;
  update public.institut_paiements set statut = 'echoue'
   where fedapay_transaction_id = p_transaction_id and statut = 'en_attente';
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$function$;

revoke all on function public.institut_echouer_paiement(text) from public, anon, authenticated;
grant execute on function public.institut_echouer_paiement(text) to service_role;
