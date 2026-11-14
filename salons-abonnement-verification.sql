-- =========================================================
-- MAHOUTO+ — Abonnement des salons : VÉRIFICATION « personne n'a perdu son accès »
--
-- Preuve en deux temps pour les membres à vie (achats « paid » de salons, public.purchases) :
--   PARTIE 1 « AVANT » : à lancer AVANT salons-abonnement.sql. Compte, par salon, les membres à vie et
--                        garde l'empreinte (md5) des 4 règles d'origine de public.messages.
--   PARTIE 2 « APRÈS » : à lancer APRÈS salons-abonnement.sql. Recompte et compare. Attendu : TOUTES les
--                        lignes « OK », et « 0 accès perdu » en dernière ligne.
--
-- ► À exécuter À LA MAIN dans Supabase (SQL Editor), d'abord sur le projet de TEST. Lancez chaque partie
--   séparément (sélectionnez-la, puis « Run »).
-- ► Confidentialité : la table d'instantané public.zz_verif_salons_avant ne contient QUE des comptes par
--   salon et des empreintes de règles — JAMAIS d'identifiant de membre. Sa RLS est activée SANS aucune
--   règle (personne ne la lit ni ne l'écrit via l'API) et tous les droits sont retirés à anon /
--   authenticated. Elle est supprimée par salons-abonnement-rollback.sql, ou à la main (dernier bloc).
-- ► Pourquoi cette preuve est solide : salons-abonnement.sql n'écrit jamais dans public.purchases et
--   n'altère pas les 4 règles d'origine ; il n'AJOUTE que des règles permissives (« OU »). Si le nombre de
--   membres à vie par salon et l'empreinte des 4 règles sont identiques avant/après, aucun membre à vie
--   n'a pu perdre son accès. Limite : cette vérification ne simule pas la connexion d'un membre ; faites
--   aussi, sur le projet de TEST, un essai avec un vrai compte membre à vie (voir le rapport de la PR).
-- =========================================================


-- =========================================================
-- PARTIE 1 — AVANT (à lancer AVANT salons-abonnement.sql)
-- =========================================================
create table if not exists public.zz_verif_salons_avant (
  rubrique text not null,     -- 'membres_vie' | 'regle'
  cle text not null,          -- identifiant du salon, ou nom de la règle
  valeur text not null,       -- nombre de membres à vie, ou empreinte md5 de la règle
  releve_le timestamptz not null default now(),
  primary key (rubrique, cle)
);
alter table public.zz_verif_salons_avant enable row level security;     -- aucune règle : inaccessible via l'API
revoke all on public.zz_verif_salons_avant from anon, authenticated;

do $$
begin
  if exists (select 1 from public.zz_verif_salons_avant) then
    raise notice 'Un instantané « avant » existe déjà : il est CONSERVÉ (non écrasé). Pour le refaire : delete from public.zz_verif_salons_avant;';
    return;
  end if;

  insert into public.zz_verif_salons_avant (rubrique, cle, valeur)
  select 'membres_vie', r.id, count(distinct p.user_id)::text
    from public.rooms r
    left join public.purchases p
           on p.course_id = r.id and p.product_type = 'salon' and p.status = 'paid'
   where r.is_paid = true
   group by r.id;

  insert into public.zz_verif_salons_avant (rubrique, cle, valeur)
  select 'regle', pol.policyname,
         md5(coalesce(pol.qual, '') || '|' || coalesce(pol.with_check, '') || '|' || pol.cmd)
    from pg_policies pol
   where pol.schemaname = 'public' and pol.tablename = 'messages'
     and pol.policyname in ('messages_public_read', 'messages_insert_own', 'messages_update_own', 'messages_delete_room_owner_or_admin');

  raise notice 'Instantané « avant » enregistré.';
end $$;

-- Lecture de l'instantané (à garder sous les yeux) :
select rubrique, cle, valeur from public.zz_verif_salons_avant order by rubrique, cle;


-- =========================================================
-- PARTIE 2 — APRÈS (à lancer APRÈS salons-abonnement.sql)
-- =========================================================
-- 2a. Membres à vie par salon : avant / après (chaque ligne doit dire OK)
select a.cle as salon,
       a.valeur::int as membres_vie_avant,
       coalesce(n.nb, 0) as membres_vie_apres,
       case when coalesce(n.nb, 0) >= a.valeur::int then 'OK' else 'PROBLÈME : accès perdu' end as verdict
  from public.zz_verif_salons_avant a
  left join (
        select p.course_id as room_id, count(distinct p.user_id) as nb
          from public.purchases p
         where p.product_type = 'salon' and p.status = 'paid'
         group by p.course_id
       ) n on n.room_id = a.cle
 where a.rubrique = 'membres_vie'
 order by a.cle;

-- 2b. Les 4 règles d'origine de public.messages sont strictement inchangées (empreintes identiques)
select a.cle as regle,
       case when m.policyname is null then 'PROBLÈME : règle absente'
            when md5(coalesce(m.qual, '') || '|' || coalesce(m.with_check, '') || '|' || m.cmd) = a.valeur then 'OK'
            else 'PROBLÈME : règle modifiée' end as verdict
  from public.zz_verif_salons_avant a
  left join pg_policies m
         on m.schemaname = 'public' and m.tablename = 'messages' and m.policyname = a.cle
 where a.rubrique = 'regle'
 order by a.cle;

-- 2c. Aucun salon existant ne passe en mode abonnement tout seul (attendu : 0 jusqu'à ce que VOUS en activiez un)
select count(*) as salons_en_mode_abonnement from public.rooms where abonnement = true;

-- 2d. Synthèse : « 0 accès perdu » attendu
select
  (select count(*) from public.zz_verif_salons_avant a
     left join (select p.course_id as room_id, count(distinct p.user_id) as nb
                  from public.purchases p
                 where p.product_type = 'salon' and p.status = 'paid' group by p.course_id) n on n.room_id = a.cle
    where a.rubrique = 'membres_vie' and coalesce(n.nb, 0) < a.valeur::int)
  +
  (select count(*) from public.zz_verif_salons_avant a
     left join pg_policies m on m.schemaname = 'public' and m.tablename = 'messages' and m.policyname = a.cle
    where a.rubrique = 'regle'
      and (m.policyname is null
           or md5(coalesce(m.qual, '') || '|' || coalesce(m.with_check, '') || '|' || m.cmd) <> a.valeur))
  as acces_perdus;


-- =========================================================
-- NETTOYAGE (facultatif, à lancer à la main une fois la preuve archivée)
-- =========================================================
-- drop table if exists public.zz_verif_salons_avant;
