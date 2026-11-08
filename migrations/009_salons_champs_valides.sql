-- ============================================================
-- MAHOUTO+ — 009 : formats imposés aux champs d'affichage d'un salon
-- ============================================================
--
-- Problème (faille XSS stockée) : la politique « rooms_insert_own » laisse
-- tout compte réel connecté (Google ou e-mail confirmé : les connexions anonymes
-- sont désactivées sur Supabase) créer un salon avec n'importe quelle
-- valeur dans color, emoji et photo_url. Ces champs étaient insérés dans du
-- HTML par discussions.html, mes-achats.html et admin/rooms.html : du code
-- pouvait s'exécuter chez tous ceux qui ouvraient la liste des salons. Le
-- code de la PR corrige l'affichage (DOM, valeurs validées) ; cette
-- migration impose les MÊMES formats côté base, pour que de telles valeurs ne
-- puissent plus être enregistrées, même par un appel direct à l'API.
--
-- Contraintes CHECK ajoutées sur public.rooms :
--   rooms_color_hex_check   color : hexadécimal #RGB, #RGBA, #RRGGBB ou #RRGGBBAA.
--                           Toutes les valeurs produites par le code (#22C55E,
--                           #FFD700, #38BDF8 : salons de départ, création dans
--                           discussions.html et admin/rooms.html) y sont.
--   rooms_emoji_safe_check  emoji : 1 à 16 caractères, sans < > " ' & ni
--                           caractère de contrôle (💬, 📣, 🛠️ et les émojis
--                           composés y sont).
--   rooms_photo_url_check   photo_url : NULL, ou https:// sans espace, sans
--                           guillemet, sans < > ` \ , 2048 caractères au plus
--                           (les adresses Cloudinary https://res.cloudinary.com/…
--                           y sont).
--
-- Les trois contraintes sont créées NOT VALID (elles s'appliquent tout de
-- suite aux nouvelles lignes et aux modifications), puis VALIDÉES
-- seulement si AUCUNE ligne existante ne les viole. S'il en existe, le script
-- le dit (message) et laisse la contrainte NOT VALID : rien n'est modifié ni
-- supprimé. Une ligne existante qui viole une contrainte non validée ne
-- peut plus être modifiée (même pour un autre champ) tant qu'elle n'est pas
-- nettoyée.
--
-- AVANT de lancer ce script :
--   1. exécuter migrations/a_valider/009_salons_violations_lecture_seule.sql
--      (lecture seule) : il liste les salons qui violent ces formats ;
--   2. s'il y en a, décider de leur sort, puis (après relecture) lancer
--      migrations/a_valider/009_salons_nettoyage.sql, puis relancer ce script.
--
-- ⚠️ À EXÉCUTER MANUELLEMENT (SQL Editor Supabase), APRÈS la fusion et le
-- déploiement de la PR (qui corrige l'affichage). Aucune donnée n'est
-- modifiée par ce script.
-- Retour arrière : migrations/rollback/009_salons_champs_valides.sql
-- ------------------------------------------------------------

begin;

alter table public.rooms drop constraint if exists rooms_color_hex_check;
alter table public.rooms
  add constraint rooms_color_hex_check
  check (color ~ '^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$')
  not valid;

alter table public.rooms drop constraint if exists rooms_emoji_safe_check;
alter table public.rooms
  add constraint rooms_emoji_safe_check
  check (char_length(emoji) between 1 and 16 and emoji !~ '[<>"''&[:cntrl:]\u2028\u2029]')
  not valid;

alter table public.rooms drop constraint if exists rooms_photo_url_check;
alter table public.rooms
  add constraint rooms_photo_url_check
  check (photo_url is null or (char_length(photo_url) <= 2048 and photo_url ~* '^https://[^[:space:]"''<>`\\]+$'))
  not valid;

-- Validation seulement si aucune ligne existante ne viole la contrainte.
do $$
declare
  c record;
  nb bigint;
begin
  for c in
    select * from (values
      ('rooms_color_hex_check',  $q$select count(*) from public.rooms where not (color ~ '^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$')$q$),
      ('rooms_emoji_safe_check', $q$select count(*) from public.rooms where not (char_length(emoji) between 1 and 16 and emoji !~ '[<>"''&[:cntrl:]\u2028\u2029]')$q$),
      ('rooms_photo_url_check',  $q$select count(*) from public.rooms where not (photo_url is null or (char_length(photo_url) <= 2048 and photo_url ~* '^https://[^[:space:]"''<>`\\]+$'))$q$)
    ) as t(name, q)
  loop
    execute c.q into nb;
    if nb = 0 then
      execute format('alter table public.rooms validate constraint %I', c.name);
      raise notice 'Contrainte % validee (aucune ligne existante ne la viole).', c.name;
    else
      raise notice 'Contrainte % laissee NOT VALID : % ligne(s) existante(s) la violent. Voir migrations/a_valider/009_salons_violations_lecture_seule.sql, puis nettoyer et relancer.', c.name, nb;
    end if;
  end loop;
end $$;

commit;

-- Contrôle (lecture seule) : conname, convalidated (true = validée sur toutes les lignes).
--   select conname, convalidated from pg_constraint
--   where conrelid = 'public.rooms'::regclass and conname in ('rooms_color_hex_check', 'rooms_emoji_safe_check', 'rooms_photo_url_check');
