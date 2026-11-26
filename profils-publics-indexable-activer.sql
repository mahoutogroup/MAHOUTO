-- =========================================================
-- MAHOUTO+ - Profil public : ACTIVER (ou retirer) l indexation d une page, a la main
-- A lancer volontairement dans l editeur SQL de Supabase, APRES profils-publics-indexable.sql.
-- Dans l editeur, auth.uid() est vide : le declencheur laisse passer (serveur), seul un
-- administrateur du projet y a acces. Un membre ne peut pas faire cela.
-- =========================================================


-- BLOC 1 - Trouver l adresse exacte de la page (lecture seule)
select adresse, nom_affiche, publie, suspendu, indexable
  from public.profils_publics
 where nom_affiche ilike 'Mahouto Abdallah%';


-- BLOC 2 - Activer : remplacez ADRESSE par l adresse trouvee (page publiee et non suspendue)
update public.profils_publics
   set indexable = true
 where adresse = 'ADRESSE' and publie and not suspendu;


-- BLOC 3 - Verifier : la fonction publique doit renvoyer true
select public.profil_public_indexable('ADRESSE') as indexable_maintenant;


-- BLOC 4 - Retirer l indexation (la page redevient noindex, cache de 60 secondes)
update public.profils_publics
   set indexable = false
 where adresse = 'ADRESSE';
