-- =========================================================
-- MAHOUTO+ - Phrase d accroche d un salon payant (affichee sur l ecran verrouille)
--
-- Ce fichier ajoute UNE colonne texte facultative, rooms.accroche (120 caracteres au maximum,
-- sans retour a
-- la ligne). Rien d autre.
--
-- ADDITIF et SANS NOUVEAU DROIT : aucune politique n est creee ni modifiee, aucune fonction,
-- aucun droit.
--   - LECTURE : la table rooms est deja lisible sans compte par la politique rooms_public_read,
--   exactement
--     comme le nom et le prix. La nouvelle colonne suit le meme chemin : rien a ajouter.
--   - ECRITURE : la politique existante rooms_update_own_or_admin s applique a la nouvelle
--   colonne comme aux
--     autres : tant qu un salon est payant, seul un administrateur peut le modifier ; le createur
--   d un salon
--     gratuit peut modifier le sien. Aucune autre personne ne peut ecrire.
--   - Pour un salon payant, la phrase s ecrit donc depuis admin/rooms.html (reglages des salons).
--
-- A EXECUTER A LA MAIN dans Supabase (SQL Editor), BLOC PAR BLOC : copier un bloc, l executer, passer au
-- suivant. Chaque bloc est court, autonome et se relance sans erreur. Aucun commentaire ne contient
-- d apostrophe et tous les commentaires sont AVANT les instructions (collage mobile).
-- ORDRE : executer ce fichier AVANT de deployer le code de la PR, puis salon-accroche-verification.sql.
-- Sans lui, rien ne casse : le code lit le salon sans la colonne et le champ des reglages reste masque.
--
-- BLOCS (dans l ordre) :
--   BLOC 1 - Verification des prerequis. Ne modifie rien.
--   BLOC 2 - Colonne rooms.accroche (texte, facultative, vide par defaut).
--   BLOC 3 - Contrainte de longueur : 120 caracteres au maximum.
--   BLOC 4 - Contrainte : aucun retour a la ligne dans l accroche.
--
-- Retour arriere : salon-accroche-rollback.sql.  Verification : salon-accroche-verification.sql.
-- =========================================================


-- BLOC 1 - Verification des prerequis (ne modifie rien)
-- La table rooms, sa lecture publique et sa politique de modification doivent exister.
do $$
begin
  if to_regclass('public.rooms') is null then
    raise exception 'Table rooms introuvable : executez d abord supabase-schema.sql';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'Fonction is_admin() introuvable';
  end if;
  if not exists (select 1 from pg_policies q
                  where q.schemaname = 'public' and q.tablename = 'rooms'
                    and q.policyname = 'rooms_public_read') then
    raise exception 'Politique rooms_public_read introuvable';
  end if;
  if not exists (select 1 from pg_policies q
                  where q.schemaname = 'public' and q.tablename = 'rooms'
                    and q.policyname = 'rooms_update_own_or_admin') then
    raise exception 'Politique rooms_update_own_or_admin introuvable';
  end if;
end $$;


-- BLOC 2 - Colonne accroche : texte facultatif, vide par defaut (les salons existants ne changent pas)
alter table public.rooms add column if not exists accroche text;


-- BLOC 3 - Longueur : 120 caracteres au maximum (vide permis)
alter table public.rooms drop constraint if exists rooms_accroche_longueur_check;

alter table public.rooms
  add constraint rooms_accroche_longueur_check
  check (accroche is null or char_length(accroche) <= 120);


-- BLOC 4 - Un seul paragraphe : ni retour a la ligne ni tabulation
alter table public.rooms drop constraint if exists rooms_accroche_une_ligne_check;

alter table public.rooms
  add constraint rooms_accroche_une_ligne_check
  check (accroche is null
         or (position(chr(10) in accroche) = 0 and position(chr(13) in accroche) = 0
             and position(chr(9) in accroche) = 0));
