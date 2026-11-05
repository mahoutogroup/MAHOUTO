-- ============================================================
-- MAHOUTO+ — 000 : requêtes de contrôle EN LECTURE SEULE
-- ============================================================
--
-- Aucune écriture, aucune modification : uniquement des SELECT. À lancer
-- dans l'éditeur SQL de Supabase AVANT les migrations 001 à 005, puis à
-- me renvoyer le résultat : les migrations seront finalisées d'après
-- l'état réel de la base.
--
-- ⚠️ L'éditeur n'affiche que le RÉSULTAT DU DERNIER ORDRE. Chaque requête
-- ci-dessous renvoie donc UNE ligne et UNE colonne (un JSON lisible) :
-- exécutez-les séparément, l'une après l'autre (sélectionnez une seule
-- requête puis « Run »).
-- ------------------------------------------------------------


-- ============================================================
-- REQUÊTE 1 — état réel de la base (politiques, droits des visiteurs,
-- déclencheurs, fonctions, comptes anonymes)
-- ============================================================

select jsonb_pretty(jsonb_build_object(
  'politiques', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', tablename, 'politique', policyname, 'commande', cmd, 'roles', roles,
      'permissive', permissive, 'using', qual, 'with_check', with_check
    ) order by tablename, policyname), '[]'::jsonb)
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'messages', 'dm_messages', 'dm_conversations', 'rooms', 'purchases',
                        'hidden_messages', 'read_state', 'message_reports', 'reserved_usernames')
  ),
  'rls_activee', (
    select coalesce(jsonb_object_agg(c.relname, jsonb_build_object('rls', c.relrowsecurity, 'rls_forcee', c.relforcerowsecurity)), '{}'::jsonb)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname in ('profiles', 'messages', 'dm_messages', 'dm_conversations', 'rooms', 'purchases', 'message_reports', 'reserved_usernames')
  ),
  'droits_tables_visiteur_et_connecte', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', t,
      'visiteur_select', has_table_privilege('anon', to_regclass('public.' || t), 'select'),
      'visiteur_insert', has_table_privilege('anon', to_regclass('public.' || t), 'insert'),
      'connecte_select', has_table_privilege('authenticated', to_regclass('public.' || t), 'select'),
      'connecte_insert', has_table_privilege('authenticated', to_regclass('public.' || t), 'insert'),
      'connecte_update', has_table_privilege('authenticated', to_regclass('public.' || t), 'update'),
      'connecte_delete', has_table_privilege('authenticated', to_regclass('public.' || t), 'delete')
    ) order by t), '[]'::jsonb)
    from unnest(array['profiles', 'messages', 'dm_messages', 'dm_conversations', 'rooms', 'purchases', 'message_reports']) as t
    where to_regclass('public.' || t) is not null
  ),
  'declencheurs', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', c.relname, 'declencheur', g.tgname, 'actif', g.tgenabled <> 'D', 'fonction', p.proname
    ) order by c.relname, g.tgname), '[]'::jsonb)
    from pg_trigger g
    join pg_class c on c.oid = g.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = g.tgfoid
    where not g.tgisinternal and n.nspname = 'public'
      and c.relname in ('profiles', 'messages', 'dm_messages', 'dm_conversations', 'rooms', 'message_reports')
  ),
  'fonctions', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'fonction', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
      'security_definer', p.prosecdef,
      'visiteur_peut_executer', has_function_privilege('anon', p.oid, 'execute'),
      'connecte_peut_executer', has_function_privilege('authenticated', p.oid, 'execute'),
      'renvoie', pg_get_function_result(p.oid)
    ) order by p.proname), '[]'::jsonb)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('get_public_profile', 'search_profiles', 'is_admin', 'get_or_create_dm_conversation', 'is_reserved_username')
  ),
  'colonnes_profiles', (
    select coalesce(jsonb_agg(jsonb_build_object('colonne', column_name, 'type', data_type) order by ordinal_position), '[]'::jsonb)
    from information_schema.columns where table_schema = 'public' and table_name = 'profiles'
  ),
  'index_et_unicite_profiles', (
    select coalesce(jsonb_agg(indexdef order by indexname), '[]'::jsonb)
    from pg_indexes where schemaname = 'public' and tablename = 'profiles'
  ),
  'publication_temps_reel', (
    select coalesce(jsonb_agg(schemaname || '.' || tablename order by tablename), '[]'::jsonb)
    from pg_publication_tables where pubname = 'supabase_realtime'
  ),
  'extensions_installees', (
    select coalesce(jsonb_agg(extname order by extname), '[]'::jsonb) from pg_extension
  ),
  'comptes', jsonb_build_object(
    'utilisateurs_total', (select count(*) from auth.users),
    'utilisateurs_anonymes', (select count(*) from auth.users where is_anonymous),
    'profils_total', (select count(*) from public.profiles),
    'profils_dont_le_pseudo_ressemble_a_un_email', (select count(*) from public.profiles where username like '%@%'),
    'profils_avec_nom_legal_renseigne', (select count(*) from public.profiles where full_name is not null and full_name <> ''),
    'messages_de_salon_total', (select count(*) from public.messages),
    'messages_de_salon_ecrits_par_des_anonymes', (select count(*) from public.messages m join auth.users u on u.id = m.user_id where u.is_anonymous),
    'conversations_privees_total', (select count(*) from public.dm_conversations),
    'conversations_privees_impliquant_un_anonyme', (select count(*) from public.dm_conversations c where exists (select 1 from auth.users u where u.id in (c.user_one, c.user_two) and u.is_anonymous))
  ),
  'objets_des_migrations_deja_presents', jsonb_build_object(
    'table_reserved_usernames', to_regclass('public.reserved_usernames') is not null,
    'table_message_reports', to_regclass('public.message_reports') is not null,
    'politique_profiles_select_own_or_admin', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_own_or_admin')
  )
)) as diagnostic;


-- ============================================================
-- REQUÊTE 2 — comptes et messages qui portent DÉJÀ un nom réservé
-- (même normalisation que la migration 002 : casse, accents, espaces,
-- tirets, chiffres et symboles de substitution, lettres cyrilliques et
-- grecques proches). Ne modifie RIEN : sert à décider, compte par compte,
-- de la suite à donner.
-- ============================================================

with cfg as (
  select 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŸавекмнорстухіјѕАВЕКМНОРСТУХІЈЅαβεικμνορτυχΑΒΕΙΚΜΝΟΡΤΥΧ@$!|'::text as frm,
         'aaaaaaceeeeiiiinooooouuuuyyaaaaaaceeeeiiiinooooouuuuyyabekmhopctyxijsabekmhopctyxijsabeikmvoptuxabeikmvoptuxas11'::text as tto
),
liste(label) as (
  values ('MAJESTÉ AI'), ('MAJESTE AI'), ('MAHOUTO'), ('MAHOUTO+'), ('MAHOUTO SCHOOL'),
         ('MAJESTÉ PRESSE'), ('Admin'), ('Support'), ('Fondateur'), ('Annonces')
),
reserves as (
  select distinct
         l.label,
         regexp_replace(translate(b.s, '430571', 'aeosti'), '[^a-z0-9]', '', 'g') as n
  from liste l
  cross join cfg
  cross join lateral (select translate(replace(replace(lower(l.label), 'œ', 'oe'), 'æ', 'ae'), cfg.frm, cfg.tto) as s) b
),
profils_norm as (
  select p.id, p.username, p.role, p.created_at, v.n
  from public.profiles p
  cross join cfg
  cross join lateral (select translate(replace(replace(lower(coalesce(p.username, '')), 'œ', 'oe'), 'æ', 'ae'), cfg.frm, cfg.tto) as s) b
  cross join lateral (values
    (regexp_replace(translate(b.s, '430571', 'aeosti'), '[^a-z0-9]', '', 'g')),
    (regexp_replace(translate(b.s, '430571', 'aeostl'), '[^a-z0-9]', '', 'g'))
  ) as v(n)
),
profils_trouves as (
  select distinct on (pn.id) pn.id, pn.username, pn.role, pn.created_at, r.label
  from profils_norm pn join reserves r on r.n = pn.n
  order by pn.id, r.label
),
messages_norm as (
  select m.user_id, m.username, count(*) as nb, min(m.created_at) as premier, max(m.created_at) as dernier, v.n
  from public.messages m
  cross join cfg
  cross join lateral (select translate(replace(replace(lower(coalesce(m.username, '')), 'œ', 'oe'), 'æ', 'ae'), cfg.frm, cfg.tto) as s) b
  cross join lateral (values
    (regexp_replace(translate(b.s, '430571', 'aeosti'), '[^a-z0-9]', '', 'g')),
    (regexp_replace(translate(b.s, '430571', 'aeostl'), '[^a-z0-9]', '', 'g'))
  ) as v(n)
  group by m.user_id, m.username, v.n
),
messages_trouves as (
  select distinct on (mn.user_id, mn.username) mn.user_id, mn.username, mn.nb, mn.premier, mn.dernier, r.label
  from messages_norm mn join reserves r on r.n = mn.n
  order by mn.user_id, mn.username, r.label
)
select jsonb_pretty(jsonb_build_object(
  'liste_reservee_utilisee', (select jsonb_agg(distinct label order by label) from reserves),
  'profils_portant_un_nom_reserve', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', pt.id, 'pseudo', pt.username, 'role', pt.role, 'cree_le', pt.created_at,
      'compte_anonyme', coalesce(u.is_anonymous, false), 'nom_reserve_correspondant', pt.label
    ) order by pt.created_at), '[]'::jsonb)
    from profils_trouves pt left join auth.users u on u.id = pt.id
  ),
  'noms_affiches_reserves_dans_des_messages_de_salon', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'auteur_id', mt.user_id, 'nom_affiche', mt.username, 'nb_messages', mt.nb,
      'premier_message', mt.premier, 'dernier_message', mt.dernier,
      'pseudo_actuel_du_profil', p.username,
      'meme_nom_que_le_profil', p.username = mt.username
    ) order by mt.nb desc), '[]'::jsonb)
    from messages_trouves mt left join public.profiles p on p.id = mt.user_id
  )
)) as comptes_portant_un_nom_reserve;


-- ============================================================
-- REQUÊTE 3 — doublons de pseudos (même normalisation que l'index unique de
-- la migration 004 : espaces, casse, accents) et pseudos qui sont une
-- adresse e-mail. À relancer jusqu'à « nb_groupes_de_doublons: 0 » avant
-- d'exécuter la migration 004. Ne modifie RIEN.
-- ============================================================

with cles as (
  select p.id, p.username, p.role, p.created_at, u.email, coalesce(u.is_anonymous, false) as anonyme,
         lower(translate(regexp_replace(trim(p.username), '\s+', ' ', 'g'), 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŸ', 'aaaaaaceeeeiiiinooooouuuuyyaaaaaaceeeeiiiinooooouuuuyy')) as cle
  from public.profiles p
  left join auth.users u on u.id = p.id
  where trim(p.username) <> ''
),
doublons as (
  select cle from cles group by cle having count(*) > 1
)
select jsonb_pretty(jsonb_build_object(
  'nb_groupes_de_doublons', (select count(*) from doublons),
  'doublons', (
    select coalesce(jsonb_agg(g.groupe order by g.cle), '[]'::jsonb)
    from (
      select c.cle, jsonb_build_object(
        'pseudo_normalise', c.cle,
        'comptes', jsonb_agg(jsonb_build_object(
          'id', c.id, 'pseudo', c.username, 'role', c.role, 'cree_le', c.created_at,
          'email', c.email, 'compte_anonyme', c.anonyme
        ) order by c.created_at)
      ) as groupe
      from cles c
      where c.cle in (select cle from doublons)
      group by c.cle
    ) g
  ),
  'profils_dont_le_pseudo_est_une_adresse_email', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'pseudo', c.username, 'role', c.role, 'cree_le', c.created_at, 'compte_anonyme', c.anonyme
    ) order by c.created_at), '[]'::jsonb)
    from cles c
    where btrim(c.username) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  'noms_affiches_en_forme_d_email_dans_des_messages_de_salon', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'auteur_id', m.user_id, 'nom_affiche', m.username, 'nb_messages', m.nb
    ) order by m.nb desc), '[]'::jsonb)
    from (
      select user_id, username, count(*) as nb
      from public.messages
      where btrim(username) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      group by user_id, username
    ) m
  )
)) as doublons_et_pseudos_email;
