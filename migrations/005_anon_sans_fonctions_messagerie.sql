-- ============================================================
-- MAHOUTO+ — 005 : retrait de l'exécution à « anon » (visiteurs non connectés)
-- ============================================================
--
-- Constat en base : get_or_create_dm_conversation, search_profiles et
-- get_public_profile sont exécutables par le rôle anon (visiteur non
-- connecté). Ce script le leur retire (et retire le droit hérité de PUBLIC),
-- et redonne l'exécution explicitement à authenticated et service_role.
--
-- ⚠️ is_admin() N'EST PAS TOUCHÉE : elle doit rester exécutable par anon, car
-- elle est utilisée par les politiques de sécurité des salons gratuits
-- (messages, rooms).
--
-- Vérification dans le code (voir la description de la PR) : aucune page
-- non connectée n'appelle ces trois fonctions.
--   - get_or_create_dm_conversation : messages-prives.html, seulement après
--     ensureLoggedIn() ;
--   - get_public_profile : dm-chat.html (conversation chargée seulement avec
--     une session), messages-prives.html (liste des conversations, après
--     connexion), share.html (conversations de la personne connectée) ;
--   - search_profiles : messages-prives.html. UN appel non connecté existait
--     (le champ de recherche appelait la fonction même sans session) : le code
--     de la PR le corrige, et c'est pourquoi ce script vient APRÈS le
--     déploiement du code.
-- Aucun autre appel dans api/ ni dans les scripts du dépôt. Les appels
-- éventuels hors de ce dépôt ne sont pas vérifiables d'ici (voir la PR).
--
-- Effet pour un visiteur : appeler ces fonctions renvoie « permission denied ».
-- Aucune donnée modifiée.
--
-- ⚠️ À EXÉCUTER MANUELLEMENT (SQL Editor Supabase), en dernier : APRÈS le
-- déploiement du code de la PR.
-- Retour arrière : migrations/rollback/005_anon_sans_fonctions_messagerie.sql
-- ------------------------------------------------------------

begin;

revoke execute on function public.get_or_create_dm_conversation(uuid) from public, anon;
revoke execute on function public.search_profiles(text) from public, anon;
revoke execute on function public.get_public_profile(uuid) from public, anon;

grant execute on function public.get_or_create_dm_conversation(uuid) to authenticated, service_role;
grant execute on function public.search_profiles(text) to authenticated, service_role;
grant execute on function public.get_public_profile(uuid) to authenticated, service_role;

-- Garde-fou : is_admin() doit rester exécutable par anon (simple avertissement si ce n'est
-- pas le cas aujourd'hui ; ce script ne la modifie pas).
do $$
begin
  if not has_function_privilege('anon', 'public.is_admin()', 'execute') then
    raise warning 'is_admin() n''est pas executable par anon : les politiques des salons gratuits peuvent echouer pour les visiteurs (non modifie par ce script).';
  end if;
end $$;

commit;
