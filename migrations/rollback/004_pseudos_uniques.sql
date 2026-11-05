-- ⚠️ ATTENTION : ce script SUPPRIME l'unicité des pseudos : deux personnes pourront de nouveau porter le même pseudo. À n'utiliser qu'en cas de problème.

begin;

drop index if exists public.profiles_username_unique_idx;

commit;
