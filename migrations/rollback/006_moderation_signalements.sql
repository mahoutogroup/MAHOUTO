-- ⚠️ ATTENTION : ce script retire la modération des signalements (migration 006) : la fonction de masquage, la politique et le déclencheur d'écriture, et les colonnes status, handled_by, handled_at, admin_note (les classements et notes déjà saisis sont PERDUS). Les signalements eux-mêmes (kind, message_id, reporter_id, reason, reported_user_id, message_text, created_at) ne sont pas touchés. Les messages déjà masqués par la fonction RESTENT masqués (is_deleted) : ce script ne les restaure pas.

begin;

drop function if exists public.admin_hide_room_message(bigint);

drop trigger if exists trg_message_report_handled on public.message_reports;
drop function if exists public.set_message_report_handled();

drop policy if exists "message_reports_update_admin" on public.message_reports;
revoke update on table public.message_reports from authenticated;

drop index if exists public.message_reports_status_created_idx;

alter table public.message_reports
  drop constraint if exists message_reports_status_check,
  drop constraint if exists message_reports_admin_note_length;

alter table public.message_reports
  drop column if exists status,
  drop column if exists handled_by,
  drop column if exists handled_at,
  drop column if exists admin_note;

commit;
