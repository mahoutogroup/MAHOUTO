-- =========================================================
-- MAHOUTO+ - Invitations : RETOUR ARRIERE de invitations.sql
--
-- Dans l ordre inverse de la creation. Chaque bloc se relance sans erreur.
-- BLOC 1 : retire les trois fonctions (sans perte de donnees). Apres ce bloc, la section du profil reste
-- masquee et l enregistrement du code est ignore en silence. Deployez d abord le code precedent (sans
-- la PR) avant les blocs 2 et 3.
-- BLOC 2 : supprime la table des comptes comptes (confirmation requise : la liste des comptes deja
-- comptes est PERDUE, un compte pourrait etre recompte si les fonctions revenaient).
-- BLOC 3 : supprime la table des codes (confirmation requise : les codes et les compteurs sont PERDUS,
-- les liens deja partages ne fonctionneront plus).
-- Aucune autre table, aucune page, aucune statistique n est touchee.
-- =========================================================


-- BLOC 1 - Retrait des fonctions (sans confirmation, sans perte de donnees)
drop function if exists public.invitation_admin_totaux();

drop function if exists public.invitation_enregistrer(text);

drop function if exists public.invitation_mon_code();


-- BLOC 2 - Table des comptes comptes (confirmation requise : la liste est PERDUE)
do $$
declare
  confirmation constant text := 'NON';
  n_comptes integer := 0;
begin
  if to_regclass('public.invitations_comptes_comptes') is not null then
    execute 'select count(*) from public.invitations_comptes_comptes' into n_comptes;
  end if;
  raise warning 'ATTENTION : % comptes comptes seront PERDUS.', n_comptes;
  if confirmation <> 'OUI' then
    raise exception 'Retour arriere NON confirme. Editez confirmation := OUI.';
  end if;
  drop table if exists public.invitations_comptes_comptes;
end $$;


-- BLOC 3 - Table des codes (confirmation requise : les codes et les compteurs sont PERDUS)
do $$
declare
  confirmation constant text := 'NON';
  n_codes integer := 0;
begin
  if to_regclass('public.invitations_codes') is not null then
    execute 'select count(*) from public.invitations_codes' into n_codes;
  end if;
  raise warning 'ATTENTION : % codes seront PERDUS.', n_codes;
  if confirmation <> 'OUI' then
    raise exception 'Retour arriere NON confirme. Editez confirmation := OUI.';
  end if;
  drop table if exists public.invitations_codes;
end $$;
