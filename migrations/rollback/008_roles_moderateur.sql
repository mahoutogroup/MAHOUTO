-- ⚠️ ATTENTION : ce script retire le rôle « modérateur » (migration 008) : tous les modérateurs perdent leurs droits (la colonne profiles.is_moderator est supprimée), l'historique role_changes est SUPPRIMÉ (à exporter avant), et admin_hide_room_message redevient réservée aux admins. Les rôles de profiles.role, les signalements et les messages ne sont pas modifiés ; les messages déjà masqués restent masqués.

begin;

drop policy if exists "message_reports_select_moderator" on public.message_reports;
drop policy if exists "message_reports_update_moderator" on public.message_reports;

drop function if exists public.moderator_room_messages(bigint[]);
drop function if exists public.moderator_report_people(bigint[]);

-- admin_hide_room_message : retour à la version de la migration 006 (admins seulement).
create or replace function public.admin_hide_room_message(p_message_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  old_content text;
  nb integer;
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED: reserve aux administrateurs'
      using errcode = '42501';
  end if;

  select m.content into old_content
  from public.messages m
  where m.id = p_message_id;

  if not found then
    raise exception 'MESSAGE_INTROUVABLE: ce message de salon n''existe pas'
      using errcode = 'P0002';
  end if;

  if coalesce(old_content, '') <> '' then
    update public.message_reports
       set message_text = old_content
     where kind = 'room' and message_id = p_message_id and message_text is null;
  end if;

  update public.messages
     set is_deleted = true, content = '', attachment_url = ''
   where id = p_message_id;

  update public.message_reports
     set status = 'actioned'
   where kind = 'room' and message_id = p_message_id and status = 'open';
  get diagnostics nb = row_count;

  return nb;
end;
$$;

revoke execute on function public.admin_hide_room_message(bigint) from public, anon;
grant execute on function public.admin_hide_room_message(bigint) to authenticated;

drop function if exists public.apply_role_change(uuid, uuid, text, boolean, text);

drop policy if exists "role_changes_select_founder" on public.role_changes;
drop table if exists public.role_changes;

drop trigger if exists trg_protect_moderator_flag on public.profiles;
drop function if exists public.protect_moderator_flag();

drop function if exists public.is_moderator();
drop function if exists public.is_founder();

alter table public.profiles drop column if exists is_moderator;

commit;
