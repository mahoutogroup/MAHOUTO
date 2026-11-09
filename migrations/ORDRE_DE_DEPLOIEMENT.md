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

## Partager un salon (PR 4, sans migration)

| # | Étape | Ce qu'on vérifie | Ce qui casse si on saute l'étape | Test navigateur ensuite |
|---|---|---|---|---|
| 18 | **Fusion de la PR « feat(salons): bouton Partager d'un salon »** et déploiement Vercel (aucune migration) | Voir **N11** | Rien : aucune dépendance côté base | **N11** |

- **N11.** Sur téléphone, dans un salon : le bouton 🔗 de l'en-tête ouvre la feuille de partage du téléphone ; choisir WhatsApp (message ou statut) : le message contient « Rejoins « <nom> » sur MAHOUTO+. » et l'adresse `…/chat.html?room=<salon>` ; annuler la feuille : rien ne s'affiche ; ouvrir le lien reçu dans un autre navigateur (navigation privée) : lecture seule, connexion possible, retour au même salon. Dans `discussions.html` : un 🔗 à droite de chaque salon (payants compris), sans ouvrir le salon. Sur un salon payant : le bouton 🔗 de l'écran de présentation. Sur ordinateur : fenêtre « Partager ce salon » avec « Copier le lien » et « WhatsApp ».

## Lien court d'un salon avec aperçu (PR 5, sans migration)

| # | Étape | Ce qu'on vérifie | Ce qui casse si on saute l'étape | Test navigateur ensuite |
|---|---|---|---|---|
| 19 | **Fusion de la PR « feat(salons): lien court /r/<salon> avec aperçu »** et déploiement Vercel (aucune migration) | Voir **N12** ; variable `PUBLIC_SITE_URL` sans importance ici (le site est fixé à `https://mahouto.com`) ; `SUPABASE_URL` et `SUPABASE_ANON_KEY` déjà utilisées par les autres aperçus | Rien à sauter. Sans cette fusion, le bouton Partager envoie encore `chat.html?room=…` (aperçu générique) | **N12** |

- **N12.** (1) Ouvrir `https://mahouto.com/r/general` dans un navigateur : arrivée sur `https://mahouto.com/chat.html?room=general`. (2) Coller un lien `https://mahouto.com/r/<salon>` dans **WhatsApp** (conversation ou statut) : l'aperçu montre la **photo du salon** (ou le logo M+ s'il n'a pas de photo) et son **nom** ; un salon payant : « Salon payant : X FCFA — Rejoins ce salon sur MAHOUTO+ ». (3) **Débogueur de partage de Facebook** (https://developers.facebook.com/tools/debug/) : coller le lien, « Récupérer de nouvelles informations » : titre, description, image 1200×630, `og:url`, aucun avertissement bloquant. (4) Lien d'un salon inexistant (`/r/nimporte-quoi`) : « Salon introuvable — MAHOUTO+ » et arrivée sur `discussions.html`. (5) Les anciens liens `chat.html?room=<salon>` fonctionnent toujours. (6) Après changement de la photo ou du nom d'un salon : l'aperçu se met à jour en quelques minutes côté serveur ; **WhatsApp et Facebook gardent leur propre cache** (de quelques heures à plusieurs jours) : pour forcer un nouvel aperçu, partager `https://mahouto.com/r/<salon>?v=2` ou utiliser le débogueur de Facebook.

## Achat depuis un lien de salon payant (PR 6, sans migration)

| # | Étape | Ce qu'on vérifie | Ce qui casse si on saute l'étape | Test navigateur ensuite |
|---|---|---|---|---|
| 20 | **Fusion de la PR « feat(salons): achat depuis un lien de salon payant »** et déploiement Vercel (aucune migration, aucune nouvelle fonction : toujours 12) | Voir **N13** ; variables FedaPay existantes (`FEDAPAY_SECRET_KEY`, `FEDAPAY_ENVIRONMENT`) et webhook déjà configuré | Rien à sauter. Sans cette fusion, le paiement d'un salon ramène encore sur `discussions.html` | **N13** |

- **N13.** Achat réel d'un **petit montant** : créer (ou choisir) un salon payant au prix le plus bas accepté par FedaPay (le montant est lu côté serveur dans la table `rooms`, jamais envoyé par le navigateur). (1) Navigation privée, ouvrir `https://mahouto.com/r/<salon>` : nom et prix, aucun message, « Se connecter ». (2) Se connecter par e-mail (code à 6 chiffres) ou Google : retour sur le même salon, bouton « Débloquer l'accès ». (3) Payer : à la fin, retour sur `chat.html?room=<salon>` (et non la liste des discussions) avec « Paiement en cours de vérification… » ; dès que le webhook a passé l'achat à `paid`, le salon s'ouvre et l'adresse perd `&payment=return`. (4) Contrôle en lecture seule dans Supabase : `select status, amount, created_at from purchases where product_type = 'salon' and course_id = '<salon>' order by created_at desc limit 3;` (statut `paid`). (5) Abandonner un paiement : retour avec « Le paiement a échoué ou a été annulé », bouton d'achat toujours disponible. (6) Si le webhook tarde plus de 30 secondes : « Ton paiement n'est pas encore confirmé » et bouton « Vérifier maintenant » ; **rien ne s'ouvre** tant que l'achat n'est pas `paid`. (7) Un compte sans e-mail ni Google (ancienne session anonyme) : « Connecte-toi avec Google ou ton e-mail pour acheter. ». (8) Rembourser ou supprimer ensuite l'achat de test depuis le tableau de bord FedaPay.

## Vocabulaire « communauté payante » (PR 7, sans migration)

| # | Étape | Ce qu'on vérifie | Ce qui casse si on saute l'étape | Test navigateur ensuite |
|---|---|---|---|---|
| 21 | **Fusion de la PR « feat(salons): salon payant devient communauté payante (textes affichés) »** et déploiement Vercel (aucune migration, aucune nouvelle fonction : toujours 12) | Voir **N14** | Rien à sauter. Aucun nom technique ne change (tables, colonnes, `product_type = 'salon'`, liens `/r/<salon>`) | **N14** |

- **N14.** (1) Ouvrir un lien `https://mahouto.com/r/<salon payant>` en navigation privée : « Communauté payante », prix, « Rejoins cette communauté pour lire et écrire les messages. », « 🔗 Partager cette communauté », « Connecte-toi pour débloquer cette communauté. ». (2) Partager cette communauté vers WhatsApp : « Rejoins « <nom> » sur MAHOUTO+ (communauté payante : X FCFA). » ; l'aperçu du lien `/r/<id>` affiche « Communauté payante : X FCFA — Rejoins cette communauté sur MAHOUTO+ » (WhatsApp garde l'ancien aperçu en cache : ajouter `?v=3` au lien pour le voir tout de suite). (3) Un **salon gratuit** garde tous ses textes : « Rejoins ce salon sur MAHOUTO+ », « Partager ce salon », « Tu lis ce salon en lecture seule… ». (4) `discussions.html` : « 🔒 Communauté payante » sur la ligne d'une communauté non débloquée ; après un ancien retour de paiement : « Communauté débloquée ». (5) `mes-achats.html` : section « 🔒 Mes communautés ». (6) Administration des salons : case « Communauté payante (accès sur achat) » et message de prix invalide au féminin. (7) Aucune modification des conditions de vente, des mentions légales ni des conditions vendeurs (en attente de validation juridique).

## Ma bibliothèque : achats en attente anciens masqués (PR 8, sans migration)

| # | Étape | Ce qu'on vérifie | Ce qui casse si on saute l'étape | Test navigateur ensuite |
|---|---|---|---|---|
| 22 | **Fusion de la PR « fix(achats): masquer les achats en attente anciens »** et déploiement Vercel (aucune migration, aucune écriture en base, aucune nouvelle fonction : toujours 12) | Voir **N15** | Rien à sauter : seul l'affichage change, les lignes restent en base | **N15** |

- **N15.** Sur `mes-achats.html` : un achat « En attente » de plus de 3 jours n'apparaît plus ; un achat « En attente » de moins de 3 jours reste visible ; un « En attente » à côté d'un achat payé du même article (salon, formation ou produit) n'apparaît jamais ; les achats payés restent tous visibles ; les paiements échoués ne sont pas affichés. Contrôle en lecture seule dans Supabase : `select status, created_at from purchases where user_id = '<ton id>' order by created_at desc;` (les lignes masquées y sont toujours). Un paiement tardif qui passe à `paid` réapparaît tout seul.

## Accroche de l'accueil MAJESTÉ PRESSE (PR 9, sans migration)

| # | Étape | Ce qu'on vérifie | Ce qui casse si on saute l'étape | Test navigateur ensuite |
|---|---|---|---|---|
| 23 | **Fusion de la PR « feat(accueil): nouvelle accroche MAJESTÉ PRESSE »** et déploiement Vercel (aucune migration, aucune nouvelle fonction : toujours 12) | Voir **N16** | Rien à sauter : texte seulement | **N16** |

- **N16.** Sur `https://majestepresse.com` (téléphone, puis navigation privée) : sous « MAJESTÉ PRESSE », une seule phrase « Imprimeurs et sérigraphes : votre plateforme pour vendre, apprendre et échanger. » sur deux lignes au maximum, en blanc comme avant ; plus de « Informer • Former • Inspirer » ni de « La presse qui éclaire… ». Logo et boutons de connexion inchangés. Sur `https://mahouto.com` : accueil inchangé (« Apprendre • Créer • Entreprendre » et « Construire l'Afrique numérique de demain. »). Si l'ancien texte s'affiche encore : fermer et rouvrir l'application (cache hors ligne v98).

## Écouter un message à voix haute (PR 10, sans migration)

| # | Étape | Ce qu'on vérifie | Ce qui casse si on saute l'étape | Test navigateur ensuite |
|---|---|---|---|---|
| 24 | **Fusion de la PR « feat(salons): bouton écouter sous les messages »** et déploiement Vercel (aucune migration, aucune API externe, aucune nouvelle fonction : toujours 12) | Voir **N17** | Rien à sauter : tout se passe sur l'appareil | **N17** |

- **N17.** Sur ton téléphone (Chrome Android, puis Safari iPhone si possible), dans un salon : un petit 🔊 sous chaque message texte (pas sous un message supprimé, une photo/fichier seul ou un message vide). (1) Toucher 🔊 : le message est lu en français, le bouton devient ⏹ ; retoucher ⏹ : la lecture s'arrête. (2) Toucher 🔊 sur un autre message : le premier s'arrête, le second est lu. (3) Message contenant un lien : on entend « lien », jamais l'adresse. (4) Message très long : lecture limitée (environ 1 000 caractères), sans coupure bizarre. (5) Pendant une lecture, un message arrive en direct : la lecture continue. (6) Passer à une autre application ou verrouiller l'écran, ou toucher « ← » : la lecture s'arrête. (7) Faire modifier ou supprimer le message en cours de lecture depuis un autre compte : la lecture s'arrête. (8) Téléphone sans voix française (Paramètres → Synthèse vocale) : le message « Aucune voix française n'est installée sur ton téléphone. » s'affiche une fois et la lecture continue avec la voix par défaut. (9) Dans le navigateur intégré de WhatsApp ou Facebook (ouvrir un lien de salon `/r/<salon>`) : si aucun bouton 🔊 n'apparaît, c'est normal (pas de synthèse vocale) ; aucune erreur. (10) Visiteur sans compte sur un salon gratuit : le 🔊 fonctionne ; communauté payante non débloquée : aucun message, aucun bouton.

## Même accroche sur la page de partage et le manifeste MAJESTÉ PRESSE (PR 11, sans migration)

| # | Étape | Ce qu'on vérifie | Ce qui casse si on saute l'étape | Test navigateur ensuite |
|---|---|---|---|---|
| 25 | **Fusion de la PR « feat(marque): même accroche MAJESTÉ PRESSE partout »** et déploiement Vercel (aucune migration, aucune nouvelle fonction : toujours 12) | Voir **N18** | Rien à sauter : texte seulement. L'ancienne description reste dans l'application déjà installée tant qu'elle n'est pas mise à jour | **N18** |

- **N18.** (1) Sur `https://majestepresse.com/share.html` (ou partager un fichier vers l'application) : sous « MAJESTÉ PRESSE », « Imprimeurs et sérigraphes : votre plateforme pour vendre, apprendre et échanger. », centré, en deux lignes sur téléphone ; sur `https://mahouto.com/share.html` : « L'Afrique qui apprend, crée et entreprend. » inchangé. (2) `https://majestepresse.com/manifest-majeste.json` : `description` = « MAJESTÉ PRESSE – Imprimeurs et sérigraphes : votre plateforme pour vendre, apprendre et échanger. ». (3) Application MAJESTÉ déjà installée : la description n'est relue par le téléphone qu'à sa propre mise à jour (parfois jamais) ; ce n'est pas un défaut. (4) Si l'ancien texte s'affiche encore sur la page de partage : fermer et rouvrir l'application (cache hors ligne v100).

## Écouter : mots en majuscules prononcés comme des mots (PR 12, sans migration)

| # | Étape | Ce qu'on vérifie | Ce qui casse si on saute l'étape | Test navigateur ensuite |
|---|---|---|---|---|
| 26 | **Fusion de la PR « fix(salons): lecture à voix haute des mots en majuscules »** et déploiement Vercel (aucune migration, aucune nouvelle fonction : toujours 12) | Voir **N19** | Rien à sauter : seul le texte envoyé à la voix change, le message affiché reste identique | **N19** |

- **N19.** Sur ton téléphone, dans un salon, écrire (ou faire écrire) un message « MAHOUTO et MAJESTÉ PRESSE, SÉRIGRAPHIE pour tous » puis toucher 🔊 : les mots sont **prononcés** (« mahouto », « majesté presse », « sérigraphie »), pas épelés ; la bulle garde ses majuscules. Un message « Envoie le PDF par SMS, 5 000 FCFA » : PDF, SMS et FCFA restent **épelés**. « Utilise l'IA » : IA épelé. « MAHOUTO+ » : « mahouto » (le « + » est lu « plus » ou ignoré selon la voix). Un message tout en majuscules « BONJOUR À TOUS, REJOIGNEZ MAHOUTO » est lu comme des mots. Un sigle manquant (lu comme un mot alors qu'il devrait être épelé) : l'ajouter à `SPELLED_ACRONYMS` dans `speech-reader.js`.

## Écouter : diagnostic visible quand la lecture ne démarre pas (PR 13, sans migration)

| # | Étape | Ce qu'on vérifie | Ce qui casse si on saute l'étape | Test navigateur ensuite |
|---|---|---|---|---|
| 27 | **Fusion de la PR « fix(salons): bouton écouter — diagnostic et lecture plus robuste »** et déploiement Vercel (aucune migration, aucune nouvelle fonction : toujours 12) | Voir **N20** | Rien à sauter : tout se passe sur l'appareil, rien n'est envoyé | **N20** |

- **N20.** Sur le téléphone Android (Chrome), fermer complètement l'application, la rouvrir (le cache v102 se met à jour), ouvrir `https://mahouto.com/chat.html?room=general` puis toucher 🔊 sous un message. **Cas normal** : le bouton devient ⏹ et le message est lu. **Si la lecture ne démarre pas** : le bouton redevient 🔊 et un message reste affiché ~10 s en bas de l'écran : « La lecture n'a pas démarré (code : … ) ». Noter le code et le transmettre : `error:synthesis-failed` (moteur vocal absent ou en panne : Paramètres → Synthèse vocale), `error:language-unavailable` (langue française non installée), `error:not-allowed` (navigateur qui refuse), `error:interrupted` / `error:canceled` (lecture coupée par le moteur), `speak-exception <nom>` (le navigateur refuse l'appel), `no-start` (aucun démarrage dans les 3 s), `empty` (rien à lire dans ce message), `no-api` (pas de synthèse vocale), `exception <nom>` (erreur inattendue). Rien n'est envoyé hors du téléphone.

## Signalement avant la migration 003

L'interface de signalement n'est **pas bloquante** si la table `message_reports` n'existe pas encore : le navigateur reçoit l'erreur « table introuvable » (`PGRST205` ou `42P01`), affiche « Le signalement n'est pas encore disponible. Réessaie un peu plus tard. » et désactive le bouton d'envoi. Aucune erreur technique n'est montrée. Rien à faire à la fusion, mais il vaut mieux exécuter la 003 juste après la 002 pour que le bouton fonctionne vraiment ; elle ne dépend ni de la 001, ni de la 004, ni de la 005.

## Migration 007 — déjà exécutée en production

| Étape | État | Ce qu'on vérifie | Ce qui casse si on ne l'a pas exécutée |
|---|---|---|---|
| **`007`** un admin ne modifie plus un message privé | ✅ **Déjà exécutée le 7 novembre 2026** (à la main, vérifiée par `pg_policies`). Indépendante des autres : ne pas la relancer | `select policyname, cmd, roles, qual, with_check from pg_policies where tablename = 'dm_messages' and cmd in ('UPDATE', 'ALL');` : UNE ligne, `dm_messages_update_own`, sans `is_admin()` | Un admin (founder, admin, super_admin) peut modifier ou marquer supprimé n'importe quel message privé |

Test navigateur ensuite : modifier puis supprimer son propre message privé dans `dm-chat.html` (doit fonctionner, comme avant) ; avec un compte admin, ouvrir la conversation d'un autre ne change rien (un admin ne lit pas les messages privés des autres).
