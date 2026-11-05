-- ⚠️ ATTENTION : ce script SUPPRIME la table des signalements et TOUS les signalements déjà enregistrés. À n'utiliser qu'en cas de problème (exportez d'abord les signalements si besoin).

begin;

drop table if exists public.message_reports;

commit;
