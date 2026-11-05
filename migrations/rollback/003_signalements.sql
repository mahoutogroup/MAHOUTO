-- ⚠️ ATTENTION : ce script SUPPRIME la table des signalements et TOUS les signalements déjà enregistrés, y compris les copies de messages privés signalés. À n'utiliser qu'en cas de problème (exportez d'abord les signalements si besoin).

begin;

drop trigger if exists trg_message_report_snapshot on public.message_reports;
drop table if exists public.message_reports;
drop function if exists public.fill_message_report_snapshot();

commit;
