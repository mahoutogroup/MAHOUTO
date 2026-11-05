-- ============================================================
-- MAHOUTO+ — 001 : lecture des profils restreinte
-- ============================================================
--
-- Problème : la politique « profiles_select_authenticated » laisse tout
-- compte connecté, y compris un compte ANONYME (connexion par pseudo des
-- pages salons), lire TOUTES les lignes de public.profiles : nom légal
-- (full_name), pays, rôle (admin / founder), date de création.
--
-- Correction : un utilisateur ne lit que SA propre ligne ; les admins
-- (public.is_admin()) lisent tout. Les informations publiques des autres
-- (id, pseudo, avatar) restent disponibles par les deux fonctions déjà
-- utilisées par l'interface, qui ne renvoient que ces trois champs :
--   public.get_public_profile(uid)   et   public.search_profiles(q).
-- Aucun écran ne lit directement le profil d'un autre utilisateur
-- (inventaire dans la description de la PR) : aucun changement de code
-- n'est donc nécessaire pour cette migration.
--
-- Pourquoi pas une vue publique : aucun écran n'en a besoin, et une vue
-- listant tous les pseudos et avatars permettrait de les énumérer d'un
-- seul appel (aujourd'hui, search_profiles est limitée à 20 résultats).
--
-- Aucune autre lecture n'est ouverte : pas de politique pour les
-- visiteurs non connectés, pas de vue, pas de nouvelle fonction.
--
-- Les politiques de profiles_insert_own / profiles_update_own, les DEUX
-- déclencheurs de protection du rôle (trg_prevent_profile_role_change et
-- trg_protect_role : ce script n'y touche pas, il vérifie seulement qu'ils
-- sont présents) et les fonctions SECURITY DEFINER
-- (is_admin, get_public_profile, search_profiles, vérification publique
-- des certificats) ne sont pas modifiés. Les politiques des autres
-- tables qui vérifient le rôle par « exists (select 1 from profiles ...
-- where id = auth.uid() ...) » lisent la ligne de l'appelant lui-même :
-- elles continuent de fonctionner.
--
-- ⚠️ À EXÉCUTER MANUELLEMENT (SQL Editor Supabase), APRÈS le déploiement
-- du code de la PR et APRÈS les contrôles du fichier
-- 000_diagnostic_lecture_seule.sql. Ce fichier n'est pas exécuté
-- automatiquement.
--
-- Auto-vérification : si une AUTRE politique de lecture permissive
-- existe encore sur profiles (les politiques s'additionnent), le script
-- s'arrête SANS rien changer et nomme la politique à examiner.
-- Retour arrière : migrations/rollback/001_profils_lecture_restreinte.sql
-- ------------------------------------------------------------

begin;

-- Anciennes politiques de lecture connues (noms d'après supabase-schema.sql).
drop policy if exists "profiles_select_authenticated" on public.profiles;
drop policy if exists "Lecture profils" on public.profiles;
drop policy if exists "profiles_select_own" on public.profiles;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin" on public.profiles
  for select to authenticated
  using (auth.uid() = id or public.is_admin());

do $$
declare
  autres text;
begin
  select string_agg(policyname, ', ') into autres
  from pg_policies
  where schemaname = 'public'
    and tablename = 'profiles'
    and cmd in ('SELECT', 'ALL')
    and permissive = 'PERMISSIVE'
    and policyname <> 'profiles_select_own_or_admin';

  if autres is not null then
    raise exception
      'Autre(s) politique(s) de lecture encore actives sur public.profiles : %. Rien n''a ete modifie ; examinez-les (voir 000_diagnostic_lecture_seule.sql) avant de relancer.',
      autres;
  end if;
end $$;

-- Les deux déclencheurs de protection du rôle ne sont pas modifiés ; simple avertissement
-- s'il en manque un en production.
do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'trg_prevent_profile_role_change' and not tgisinternal) then
    raise warning 'Declencheur trg_prevent_profile_role_change absent de public.profiles (non modifie par ce script).';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'trg_protect_role' and not tgisinternal) then
    raise warning 'Declencheur trg_protect_role absent de public.profiles (non modifie par ce script).';
  end if;
end $$;

commit;

-- Contrôle (lecture seule) : doit renvoyer UNE ligne, profiles_select_own_or_admin.
--   select policyname, cmd, roles, qual
--   from pg_policies
--   where schemaname = 'public' and tablename = 'profiles' and cmd in ('SELECT', 'ALL');
