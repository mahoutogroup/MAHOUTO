-- =========================================================
-- MAHOUTO+ - Profil public : liste des pages indexables pour l ecran administrateur
--
-- Ajoute UNE fonction de lecture, reservee aux administrateurs : profils_publics_admin_indexables()
-- renvoie les adresses des pages dont la colonne indexable est vraie (aucune autre colonne : ni id,
-- ni user_id, ni e-mail). Elle sert aux badges et boutons Autoriser Google et Retirer de Google de
-- admin/profils-publics.html. profils_publics_admin_lister et profils_publics_admin_indexable ne
-- sont pas modifiees.
--
-- ADDITIF : une fonction. A EXECUTER A LA MAIN dans Supabase (SQL Editor), BLOC PAR BLOC, avant la
-- fusion de la PR. Chaque bloc est court, autonome et se relance sans erreur. Aucun commentaire ne
-- contient d apostrophe et tous les commentaires sont AVANT les instructions.
-- Prerequis : profils-publics-indexable.sql deja execute.
--
-- BLOCS : 1 prerequis - 2 fonction.
--
-- Retour arriere : profils-publics-indexable-admin-rollback.sql.
-- Verification : profils-publics-indexable-admin-verification.sql.
-- =========================================================


-- BLOC 1 - Verification des prerequis (ne modifie rien)
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'profils_publics'
                    and column_name = 'indexable') then
    raise exception 'Colonne indexable introuvable : executez d abord profils-publics-indexable.sql';
  end if;
  if to_regprocedure('public.profils_publics_admin_indexable(text, boolean)') is null then
    raise exception 'profils_publics_admin_indexable introuvable : profils-publics-indexable.sql';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'Fonction is_admin introuvable';
  end if;
end $$;


-- BLOC 2 - Fonction des administrateurs : adresses des pages indexables (aucune autre colonne)
-- Refuse tout appel qui ne vient pas d un administrateur. Aucun droit pour anon ni pour public.
create or replace function public.profils_publics_admin_indexables()
 returns table (adresse text)
 language plpgsql
 stable
 security definer
 set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Reserve aux administrateurs.';
  end if;
  return query
    select p.adresse
      from public.profils_publics p
     where p.indexable
     order by p.adresse;
end;
$$;

revoke all on function public.profils_publics_admin_indexables() from public, anon;

grant execute on function public.profils_publics_admin_indexables() to authenticated;
