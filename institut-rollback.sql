-- =========================================================
-- MAHOUTO+ — Institut SAYÉ LOUIS : RETOUR ARRIÈRE de institut.sql
--
-- ⚠⚠ ATTENTION : CE FICHIER SUPPRIME les tables public.institut_demandes (demandes de parrainage),
--     public.institut_petits_fils (marquages) et public.institut_contenus (textes et interrupteur « ouvert »).
--     CETTE OPÉRATION EST IRRÉVERSIBLE : exportez d'abord ces données si besoin.
--
-- ► FICHIERS JUSTIFICATIFS : le bucket « institut-justificatifs » n'est supprimé QUE s'il est vide. Les fichiers
--   sont dans le stockage : videz le bucket depuis Supabase > Storage (pas par SQL, qui laisserait des fichiers
--   orphelins), puis relancez le BLOC 4 de ce fichier.
-- ► Ne touche JAMAIS à public.purchases, public.messages, public.rooms, public.profiles, ni à public.is_admin().
-- ► À EXÉCUTER À LA MAIN, après relecture, bloc par bloc. Par sécurité, le BLOC 1 refuse de s'exécuter tant que
--   la ligne « confirmation » n'est pas passée de 'NON' à 'OUI'. Relançable sans erreur.
-- ► Déployez d'abord le code précédent (sans l'Institut) : les pages institut-demande.html et admin/institut.html
--   lisent ces tables.
--
-- BLOCS : 1 confirmation et avertissement · 2 règles du bucket · 3 tables et fonctions · 4 bucket (si vide).
-- =========================================================


-- BLOC 1 — Confirmation et avertissement (ne supprime rien)
do $$
declare
  confirmation constant text := 'NON';   -- ← remplacez par 'OUI' pour autoriser la suppression
  n_demandes integer := 0;
  n_petits_fils integer := 0;
  n_fichiers integer := 0;
begin
  if to_regclass('public.institut_demandes') is not null then
    execute 'select count(*) from public.institut_demandes' into n_demandes;
  end if;
  if to_regclass('public.institut_petits_fils') is not null then
    execute 'select count(*) from public.institut_petits_fils' into n_petits_fils;
  end if;
  select count(*) into n_fichiers from storage.objects where bucket_id = 'institut-justificatifs';

  raise warning 'ATTENTION : % demande(s), % petit(s)-fils marqué(s) seront DÉFINITIVEMENT PERDUS ; % fichier(s) justificatif(s) restent dans le bucket (à vider depuis Storage).',
    n_demandes, n_petits_fils, n_fichiers;

  if confirmation <> 'OUI' then
    raise exception 'Retour arrière NON confirmé : aucune suppression effectuée. Éditez ce fichier (confirmation := ''OUI'') pour continuer.';
  end if;
end $$;


-- BLOC 2 — Règles d'accès du bucket (seulement celles créées par institut.sql)
drop policy if exists "institut_justificatifs_insert_own" on storage.objects;
drop policy if exists "institut_justificatifs_select" on storage.objects;
drop policy if exists "institut_justificatifs_admin_delete" on storage.objects;


-- BLOC 3 — Tables (leurs règles et déclencheurs disparaissent avec elles), puis fonctions
drop table if exists public.institut_demandes;
drop table if exists public.institut_petits_fils;
drop table if exists public.institut_contenus;

drop function if exists public.institut_demandes_garde();
drop function if exists public.institut_contenus_maj();
drop function if exists public.institut_ouvert();


-- BLOC 4 — Bucket « institut-justificatifs » : supprimé seulement s'il est vide
do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'institut-justificatifs') then
    raise notice 'Le bucket institut-justificatifs contient encore des fichiers : videz-le depuis Supabase > Storage, puis relancez ce bloc.';
  else
    delete from storage.buckets where id = 'institut-justificatifs';
  end if;
end $$;
