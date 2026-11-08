-- ============================================================
-- MAHOUTO+ — 009 (lecture seule) : salons dont color, emoji ou photo_url
-- ne respectent pas les formats de la migration 009
-- ============================================================
-- Aucune écriture : un seul SELECT. À lancer AVANT la migration 009.
-- Renvoie une ligne par salon fautif, avec la liste des règles violées.
-- (Les valeurs sont affichées telles quelles : ne pas les ouvrir dans un
-- outil qui interprète le HTML.)
-- ------------------------------------------------------------

select
  r.id,
  r.name,
  r.created_by,
  r.created_at,
  r.is_paid,
  r.color,
  r.emoji,
  r.photo_url,
  concat_ws(', ',
    case when not (r.color ~ '^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$') then 'color' end,
    case when not (char_length(r.emoji) between 1 and 16 and r.emoji !~ '[<>"''&[:cntrl:]\u2028\u2029]') then 'emoji' end,
    case when not (r.photo_url is null or (char_length(r.photo_url) <= 2048 and r.photo_url ~* '^https://[^[:space:]"''<>`\\]+$')) then 'photo_url' end
  ) as regles_violees
from public.rooms r
where not (r.color ~ '^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$')
   or not (char_length(r.emoji) between 1 and 16 and r.emoji !~ '[<>"''&[:cntrl:]\u2028\u2029]')
   or not (r.photo_url is null or (char_length(r.photo_url) <= 2048 and r.photo_url ~* '^https://[^[:space:]"''<>`\\]+$'))
order by r.created_at;
