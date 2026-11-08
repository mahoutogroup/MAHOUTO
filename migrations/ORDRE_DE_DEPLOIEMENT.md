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
| 8 | **Fusion de la PR « page admin des signalements »** et déploiement Vercel (avant la 006) | Page `admin/signalements.html` en ligne, onglet « Signalements » visible ; avant la 006 elle affiche « La modération n'est pas encore activée » (aucune erreur, tableau de bord intact) | Sauter ce code et lancer la 006 seule : rien ne casse, mais aucune page pour traiter les signalements | **N6a** |
| 9 | **`006`** modération des signalements | 4 nouvelles colonnes ; `UPDATE` limité à 4 colonnes pour `authenticated` ; politique `message_reports_update_admin` ; fonction `admin_hide_room_message` exécutable par `authenticated` seulement | La page reste en lecture seule : message « modération pas encore activée », impossible de classer ou masquer | **N6b** |

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
- **N6a (après la fusion de la page de modération, avant la 006).** Compte admin : `admin/signalements.html` s'ouvre, message « La modération n'est pas encore activée (la migration 006 n'a pas été exécutée) », aucune erreur technique ; le tableau de bord (`admin/formations.html`) et `profil.html` s'affichent sans pastille ni erreur. Compte normal : « Accès réservé aux administrateurs » puis redirection vers `profil.html`.
- **N6b (après 006).** Admin sur téléphone : la liste des ouverts apparaît, pastille rouge sur l'onglet « Signalements » et sur « Tableau de bord Administrateur » de `profil.html`. Salon : signaler le message d'un compte test depuis un autre compte, puis « Masquer le message » (confirmation) : le message disparaît du salon pour tous, le signalement passe dans « Classés ». Message privé signalé : seul le texte copié s'affiche, pas de bouton « Masquer » ; « Classer sans suite » et « Marquer traité » avec une note. Compte normal : accès refusé, et un `update` direct sur `message_reports` n'a aucun effet.

## Rôle modérateur et changement de rôle (migration 008)

| # | Étape | Ce qu'on vérifie | Ce qui casse si on saute l'étape | Test navigateur ensuite |
|---|---|---|---|---|
| 10 | **Fusion de la PR « feat(roles) »** et déploiement Vercel (avant la 008) | `admin/users.html` s'ouvre, `list-users` répond ; « Changer le rôle » affiche, avant la 008, « Le changement de rôle n'est pas encore activé » (sans erreur technique) ; `signalements.html` et `profil.html` normaux | Sans le code, la 008 seule n'ajoute aucun bouton ni page pour le modérateur | **N7a** |
| 11 | **`008`** rôle modérateur | Colonne `profiles.is_moderator` ; 3 déclencheurs de protection (`trg_prevent_profile_role_change`, `trg_protect_moderator_flag`, `trg_protect_role`) ; politiques `message_reports_*_moderator` ; `has_function_privilege('anon','public.is_admin()','execute')` toujours vrai | Le founder ne peut pas nommer de modérateur ni d'administrateur par la page (message « migration 008 pas exécutée ») ; aucun modérateur n'a de droit | **N7b** |

- **N7a (après la fusion, avant la 008).** Founder : `users.html` affiche « Changer le rôle » sur les membres (pas sur lui-même, ni sur un founder ou un super_admin) ; envoyer un changement donne « Le changement de rôle n'est pas encore activé… », rien n'est modifié. Administrateur non founder : aucun bouton. Membre : `signalements.html` répond « Accès réservé… ».
- **N7b (après la 008).** Founder : donner « Modérateur » à un compte test, puis « Administrateur » à un autre, avec un motif ; contrôle en SQL : `select * from public.role_changes order by id desc;`. Compte modérateur (téléphone) : (un modérateur qui signale lui-même un message ne peut pas le masquer ; il le peut si un autre membre l'a signalé)  `profil.html` affiche « Signalements (modération) » avec la pastille ; `signalements.html` n'a que l'onglet Signalements, liste les signalements de **salon** seulement, masque un message de salon signalé, classe un signalement ; `users.html`, `formations.html`, `rooms.html`… lui répondent « Accès réservé ». Membre ordinaire : rien de nouveau. Compte admin : voit toujours les signalements de messages privés.
- Retour arrière : `rollback/008_roles_moderateur.sql` (supprime `is_moderator` : les modérateurs perdent leurs droits ; supprime `role_changes` : à exporter avant).

## Salons : formats de color, emoji et photo_url (migration 009)

| # | Étape | Ce qu'on vérifie | Ce qui casse si on saute l'étape | Test navigateur ensuite |
|---|---|---|---|---|
| 12 | **Fusion de la PR « fix(security): XSS stockée dans la liste des salons »** et déploiement Vercel (avant la 009) | `discussions.html`, `mes-achats.html`, `admin/rooms.html` affichent les salons ; un salon piégé n'exécute rien | Sans le code, un salon piégé existant continue d'exécuter du code chez ceux qui ouvrent la liste | **N8a** |
| 13 | **`migrations/a_valider/009_salons_violations_lecture_seule.sql`** (lecture seule) | Liste des salons dont color, emoji ou photo_url sont invalides (ligne vide = rien à nettoyer) | On ne sait pas si des salons piégés existent déjà | — |
| 14 | *(seulement s'il y a des lignes)* **`migrations/a_valider/009_salons_nettoyage.sql`**, après relecture : le lancer tel quel (il s'annule), puis le relancer avec `commit;` | Valeurs invalides remplacées par `#22C55E`, `💬`, `NULL` ; noms, salons et messages intacts | La 009 laissera les contraintes NOT VALID (nouvelles lignes protégées, anciennes lignes fautives non modifiables) | — |
| 15 | **`009`** contraintes CHECK sur `rooms` | `select conname, convalidated from pg_constraint …` : trois contraintes, `convalidated = true` | Un appel direct à l'API peut encore enregistrer des valeurs piégées (le code les neutralise à l'affichage) | **N8b** |

- **N8a (après la fusion, avant la 009).** Compte de test A : créer par l'API (console du navigateur, ou outil de test) un salon avec `emoji = <img src=x onerror=alert(1)>` et `color = red" onmouseover="alert(2)` ; avec un compte B, ouvrir `discussions.html`, `mes-achats.html` (salon acheté), la fenêtre « Envoyer à… » de `share.html`/discussions ; compte admin : `admin/rooms.html`. Attendu : aucune alerte, la pastille du salon est verte avec 💬, le nom s'affiche en texte. Salon normal (couleur `#38BDF8`, photo Cloudinary) : affichage inchangé.
- **N8b (après la 009).** Même tentative d'insertion : refusée par la base (erreur `rooms_emoji_safe_check` ou `rooms_color_hex_check`) ; création d'un salon normal depuis `discussions.html` : fonctionne ; changement de photo d'un salon : fonctionne.

## Lien de salon : lecture seule pour un visiteur (PR 3a, sans migration)

| # | Étape | Ce qu'on vérifie | Ce qui casse si on saute l'étape | Test navigateur ensuite |
|---|---|---|---|---|
| 16 | **Fusion de la PR « feat(salons): lecture seule pour un visiteur »** et déploiement Vercel (aucune migration) | Voir **N9** ; requêtes de contrôle en lecture seule ci-dessous | Rien à sauter : la PR n'exige aucune migration. Si la lecture publique de `messages` ou le temps réel sans compte ne fonctionnent pas sur ta base, le visiteur voit un salon vide ou sans mise à jour en direct | **N9** |

- **N9.** Fenêtre de navigation privée, sans compte, sur `chat.html?room=general` : les messages s'affichent, la zone de saisie est remplacée par « Tu lis ce salon en lecture seule. Connecte-toi pour écrire. » ; un message envoyé **en direct** par un compte réel (autre fenêtre) apparaît **sans recharger** la fenêtre privée ; un clic sur un message ne propose que « Copier » et « Partager » ; un salon payant affiche son nom, son prix et « Se connecter », **sans aucun message** ; une adresse de salon inexistante affiche « Salon introuvable ».
- **Contrôles de la base (lecture seule)** : `select policyname, roles, cmd, qual from pg_policies where schemaname = 'public' and tablename = 'messages' and cmd = 'SELECT';` (une politique de lecture sans restriction de rôle) ; `select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages';` (une ligne) ; `select has_table_privilege('anon', 'public.messages', 'select');` (vrai).

## Lien de salon : connexion Google ou e-mail et retour au salon (PR 3b, sans migration)

| # | Étape | Ce qu'on vérifie | Ce qui casse si on saute l'étape | Test navigateur ensuite |
|---|---|---|---|---|
| 17 | **Fusion de la PR « feat(salons): connexion Google ou e-mail depuis un lien de salon »** et déploiement Vercel (aucune migration) | Voir **N10** | Rien à sauter. Réglage Supabase : les « Redirect URLs » doivent autoriser `https://mahouto.com/**` (déjà le cas d'après ta capture) | **N10** |

- **N10.** Fenêtre de navigation privée sur `chat.html?room=<salon>` : « Se connecter » ouvre la fenêtre ; **e-mail** : adresse, code reçu (6 chiffres), retour **sur le même salon**, connecté, zone de saisie visible, pseudo « Membre xxxxxx » ; mauvais code : « Code incorrect ou expiré… » ; **Google** : retour sur la même adresse `chat.html?room=<salon>`, connecté, pseudo = nom Google ; Google annulé : « Connexion Google annulée. » ; réseau coupé : « Pas de connexion internet… » ; salon payant : « Se connecter pour débloquer ce salon », puis bouton de paiement. Un compte déjà inscrit garde son pseudo.

## Signalement avant la migration 003

L'interface de signalement n'est **pas bloquante** si la table `message_reports` n'existe pas encore : le navigateur reçoit l'erreur « table introuvable » (`PGRST205` ou `42P01`), affiche « Le signalement n'est pas encore disponible. Réessaie un peu plus tard. » et désactive le bouton d'envoi. Aucune erreur technique n'est montrée. Rien à faire à la fusion, mais il vaut mieux exécuter la 003 juste après la 002 pour que le bouton fonctionne vraiment ; elle ne dépend ni de la 001, ni de la 004, ni de la 005.

## Migration 007 — déjà exécutée en production

| Étape | État | Ce qu'on vérifie | Ce qui casse si on ne l'a pas exécutée |
|---|---|---|---|
| **`007`** un admin ne modifie plus un message privé | ✅ **Déjà exécutée le 7 novembre 2026** (à la main, vérifiée par `pg_policies`). Indépendante des autres : ne pas la relancer | `select policyname, cmd, roles, qual, with_check from pg_policies where tablename = 'dm_messages' and cmd in ('UPDATE', 'ALL');` : UNE ligne, `dm_messages_update_own`, sans `is_admin()` | Un admin (founder, admin, super_admin) peut modifier ou marquer supprimé n'importe quel message privé |

Test navigateur ensuite : modifier puis supprimer son propre message privé dans `dm-chat.html` (doit fonctionner, comme avant) ; avec un compte admin, ouvrir la conversation d'un autre ne change rien (un admin ne lit pas les messages privés des autres).
