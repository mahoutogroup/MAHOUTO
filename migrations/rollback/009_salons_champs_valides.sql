-- ⚠️ ATTENTION : ce script retire les contraintes de format sur public.rooms (color, emoji, photo_url) ajoutées par la migration 009 : la base accepterait de nouveau n'importe quelle valeur dans ces colonnes (le code de la PR valide toujours l'affichage). Aucune donnée n'est modifiée.

begin;

alter table public.rooms drop constraint if exists rooms_color_hex_check;
alter table public.rooms drop constraint if exists rooms_emoji_safe_check;
alter table public.rooms drop constraint if exists rooms_photo_url_check;

commit;
