# Ordre de déploiement — PR « profils, noms réservés et signalement »

Rien n'est exécuté automatiquement. Les scripts SQL se lancent à la main dans le SQL Editor Supabase, un à la fois, dans cet ordre. Les contrôles « en base » sont des requêtes en lecture seule.

Principe : **le code d'abord** (il fonctionne avant toutes les migrations), puis les migrations une par une, **avec un test en navigateur après chacune** avant de passer à la suivante.

| # | Étape | Ce qu'on vérifie | Ce qui casse si on saute l'étape | Test en vrai navigateur ensuite |
|---|---|---|---|---|
| 0 | **Fusion de la PR**, attendre le déploiement Vercel | Déploiement « Ready » ; `/pseudo.js` et `/report.js` répondent 200 ; recharger deux fois (cache hors ligne v85) | Sauter le code avant 005 : la recherche d'un visiteur non connecté reçoit « permission denied » au lieu du message « Connecte-toi ». Sans le code, un nouveau compte reçoit encore son e-mail comme pseudo | **N0** (voir plus bas) |
| 1 | **`000` diagnostic** (3 requêtes, lecture seule) | Requête 1 : état réel (politiques, droits, déclencheurs). Requête 2 : comptes aux noms réservés. Requête 3 : doublons et pseudos en forme d'e-mail | Rien ne casse, mais on migre à l'aveugle (lecteurs inconnus, état de la base différent du dépôt) | — |
| 1b | **Logs API Supabase, 7 jours** | Aucun appel venant d'ailleurs que du site à `/rest/v1/profiles` (avant 001) et aux 3 fonctions `rpc` (avant 005) | Un site ou outil tiers qui lit `profiles` ou appelle les fonctions cesse de fonctionner (001, 005) | — |
| 2 | **`001`** profils : lecture restreinte | Un compte normal : `select count(*) from profiles` = 1 ; un admin = 30 ; la requête 1 de `000` ne montre plus `profiles_select_authenticated` | Chaque personne connectée continue de pouvoir lire les 30 profils (nom légal, pays, rôle) | **N1** |
| 3 | **`002`** noms réservés (+ refus des pseudos en forme d'e-mail) | Les 9 comptes officiels sont dans `reserved_username_exempt_accounts` ; les deux déclencheurs existent | N'importe qui peut prendre « Admin », « Support », « MAJESTÉ AI », ou une adresse e-mail comme pseudo | **N2** |
| 4 | **`003`** signalements | Table `message_reports` présente, RLS activée, déclencheur `trg_message_report_snapshot` présent | L'interface de signalement reste utilisable mais répond « Le signalement n'est pas encore disponible. Réessaie un peu plus tard. » (aucun signalement enregistré) | **N3** |
| 5 | **Renommage manuel** des doublons | Requête 3 de `000` relancée : `nb_groupes_de_doublons = 0` (et pseudos en forme d'e-mail traités si tu le décides) | La `004` s'arrête proprement, sans rien modifier, en nommant le nombre de groupes restants | — |
| 6 | **`004`** pseudos uniques | Index `profiles_username_unique_idx` présent | Deux personnes peuvent porter le même pseudo (usurpation par simple copie) | **N4** |
| 7 | **`005`** retrait de `anon` | `has_function_privilege` : `anon` = false, `authenticated` = true, `service_role` = true pour les 3 fonctions ; `is_admin()` toujours true pour `anon` | Un visiteur non connecté peut appeler la recherche de profils, lire un profil public par identifiant et créer des conversations | **N5** |

Chaque migration a son retour arrière dans `migrations/rollback/`. Retour complet : 005, 004, 003, 002, 001 (le retour de 003 supprime les signalements enregistrés : les exporter avant).

## Tests en navigateur

Utiliser deux comptes normaux (A et B), un compte admin, et une fenêtre privée sans connexion.

- **N0 (après la fusion, avant toute migration).**
  - Inscription par code e-mail avec une adresse neuve : le pseudo affiché est « Membre xxxxxx », jamais l'adresse. Connexion Google : le nom Google, ou « Membre xxxxxx » s'il n'y en a pas.
  - Messages privés, non connecté : la recherche affiche « Connecte-toi depuis l'accueil pour chercher quelqu'un », sans erreur.
  - Salon (`chat.html`) : bouton « Signaler » visible sur le message d'un autre, absent sur le sien. Avant la 003, un signalement affiche le message « pas encore disponible » (pas d'erreur bloquante).
- **N1 (après 001).** A : accueil, `profil.html` (pseudo, photo, pays, nom légal), messages privés (liste, avatars et pseudos des interlocuteurs, recherche, ouverture, envoi, réception), `share.html` (liste des conversations). Admin : pages admin et liste des utilisateurs. Fenêtre privée : salons gratuits lisibles.
- **N2 (après 002).** A, `profil.html` : changer le pseudo pour « Admin », « M4JESTE AI », une adresse e-mail → refus avec message clair ; pseudo normal → accepté. Anonyme dans un salon avec « Support » → refus, puis succès avec un autre pseudo sans second compte. Un compte officiel et un compte founder peuvent garder leur pseudo ou le modifier.
- **N3 (après 003).** Salon : signaler le message de B (raison, envoi, second signalement → « Tu as déjà signalé »). Message privé reçu : **l'avertissement « En signalant, vous partagez ce message avec l'équipe de modération. » s'affiche** avant l'envoi. En SQL, en tant qu'admin : la ligne contient la copie du texte de ce seul message privé ; un admin ne lit toujours pas `dm_messages`.
- **N4 (après 004).** A, `profil.html` : prendre le pseudo de B (même en changeant la casse ou les accents) → « Ce pseudo est déjà pris ». Nouvelle inscription : pas d'erreur de collision (le pseudo neutre se rallonge à 8 caractères si besoin).
- **N5 (après 005).** Fenêtre privée sur `messages-prives.html` : message « Connecte-toi », pas d'erreur ; salons gratuits lisibles. Connecté : recherche, ouverture d'une conversation, envoi, liste des conversations dans `share.html`. Dans les logs Supabase : aucun « permission denied » inattendu pendant 24 h.

## Signalement avant la migration 003

L'interface de signalement n'est **pas bloquante** si la table `message_reports` n'existe pas encore : le navigateur reçoit l'erreur « table introuvable » (`PGRST205` ou `42P01`), affiche « Le signalement n'est pas encore disponible. Réessaie un peu plus tard. » et désactive le bouton d'envoi. Aucune erreur technique n'est montrée. Rien à faire à la fusion, mais il vaut mieux exécuter la 003 juste après la 002 pour que le bouton fonctionne vraiment ; elle ne dépend ni de la 001, ni de la 004, ni de la 005.

## Migration 007 — déjà exécutée en production

| Étape | État | Ce qu'on vérifie | Ce qui casse si on ne l'a pas exécutée |
|---|---|---|---|
| **`007`** un admin ne modifie plus un message privé | ✅ **Déjà exécutée le 7 novembre 2026** (à la main, vérifiée par `pg_policies`). Indépendante des autres : ne pas la relancer | `select policyname, cmd, roles, qual, with_check from pg_policies where tablename = 'dm_messages' and cmd in ('UPDATE', 'ALL');` : UNE ligne, `dm_messages_update_own`, sans `is_admin()` | Un admin (founder, admin, super_admin) peut modifier ou marquer supprimé n'importe quel message privé |

Test navigateur ensuite : modifier puis supprimer son propre message privé dans `dm-chat.html` (doit fonctionner, comme avant) ; avec un compte admin, ouvrir la conversation d'un autre ne change rien (un admin ne lit pas les messages privés des autres).
