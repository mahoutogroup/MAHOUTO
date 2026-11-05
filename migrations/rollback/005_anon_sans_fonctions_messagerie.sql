-- ⚠️ ATTENTION : ce script REDONNE à « anon » (visiteurs non connectés) le droit d'exécuter get_or_create_dm_conversation, search_profiles et get_public_profile (état constaté avant la migration 005).

begin;

grant execute on function public.get_or_create_dm_conversation(uuid) to public, anon, authenticated, service_role;
grant execute on function public.search_profiles(text) to public, anon, authenticated, service_role;
grant execute on function public.get_public_profile(uuid) to public, anon, authenticated, service_role;

commit;
