-- ⚠️ ATTENTION : ce script SUPPRIME la protection des pseudos réservés et des pseudos en forme d'e-mail : n'importe qui pourra de nouveau s'appeler « MAJESTÉ AI », « Admin », « Support » ou utiliser une adresse e-mail comme pseudo. À n'utiliser qu'en cas de problème.

begin;

drop trigger if exists trg_reserved_username_messages on public.messages;
drop trigger if exists trg_reserved_username_profiles on public.profiles;
drop function if exists public.enforce_reserved_username_messages();
drop function if exists public.enforce_reserved_username_profiles();
drop function if exists public.looks_like_email(text);
drop function if exists public.is_reserved_username(text);
drop function if exists public.username_variants(text);
drop table if exists public.reserved_username_exempt_accounts;
drop table if exists public.reserved_usernames;

commit;
