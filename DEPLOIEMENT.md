# MAHOUTO+ — Guide de déploiement complet (Production)

## 1. Arborescence complète du projet

```
mahoutoplus/
├── .gitignore
├── package.json
├── manifest.json
├── sw.js
├── theme.css
├── config.js
├── index.html
├── discussions.html
├── chat.html
├── ai.html
├── school.html
├── profil.html
├── api/
│   ├── fedapay-checkout.js
│   ├── fedapay-webhook.js
│   └── cloudinary-sign.js
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   └── icon-maskable-512.png
└── supabase-schema.sql   (à exécuter dans Supabase, ne va PAS sur Vercel)
```

Ordre de création respecté : configuration (package.json, manifest.json, sw.js) →
style partagé (theme.css) → config client (config.js) → pages HTML → fonctions
serverless (/api) → icônes → schéma base de données.

---

## 2. package.json

Emplacement : `/package.json`
Dépendance nécessaire : `@supabase/supabase-js` (utilisée par les fonctions
serverless `/api` pour écrire dans Supabase avec la clé service_role).

Contenu final : voir le fichier `package.json` fourni dans cette conversation
(inchangé depuis sa création).

---

## 3. Fichiers racine (déjà livrés, versions finales en place)

| Fichier | Rôle |
|---|---|
| `manifest.json` | Déclaration PWA — nom, icônes, couleurs, mode standalone |
| `sw.js` | Service worker — cache la coquille de l'app, hors-ligne, exclut `/api`, Supabase, Cloudinary, OpenRouter du cache |
| `theme.css` | Thème partagé noir premium + or, cartes, boutons, nav basse à 5 onglets |
| `config.js` | **À remplir** avec `SUPABASE_URL` et `SUPABASE_ANON_KEY` réels avant déploiement |

---

## 4. Fichiers HTML (versions finales, déjà livrées)

| Fichier | Rôle |
|---|---|
| `index.html` | Accueil — hero, chips de fonctionnalités, grille des modules, nav basse |
| `discussions.html` | Liste des salons — recherche, onglets, badges non-lus, Google Sign-In |
| `chat.html` | Conversation en temps réel — texte + pièces jointes (Cloudinary) |
| `ai.html` | Assistant IA — connecté à OpenRouter avec la clé API de l'utilisateur |
| `school.html` | Catalogue de formations — achat réel via FedaPay |
| `profil.html` | Pseudo modifiable, sections abonnements/certificats en préparation |

---

## 5. Fichiers /api (fonctions serverless Vercel)

| Fichier | Rôle | Variables lues |
|---|---|---|
| `api/fedapay-checkout.js` | Crée une transaction FedaPay, renvoie l'URL de paiement | `FEDAPAY_SECRET_KEY`, `FEDAPAY_ENVIRONMENT` (ou `FEDAPAY_ENV`), `PUBLIC_SITE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| `api/fedapay-webhook.js` | Reçoit la confirmation de paiement FedaPay, met à jour `purchases` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| `api/cloudinary-sign.js` | Génère une signature d'upload sécurisée | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` |

---

## 6. Icônes PNG

| Fichier | Taille | Usage |
|---|---|---|
| `icons/icon-192.png` | 192×192 | Icône standard (Android, favicon) |
| `icons/icon-512.png` | 512×512 | Icône standard haute résolution |
| `icons/icon-maskable-512.png` | 512×512 | Version avec marge de sécurité pour recadrage circulaire |

Basées sur le logo "M+" noir/or fourni.

---

## 7. Schéma SQL complet (Supabase)

Fichier : `supabase-schema.sql` — **déjà exécuté et vérifié** dans ton projet
Supabase (tables confirmées : `profiles`, `rooms`, `messages`, `read_state`,
`purchases`).

### Tables créées

| Table | Colonnes clés | Rôle |
|---|---|---|
| `profiles` | `id` (= auth.users.id), `username` | Pseudo lié au compte |
| `rooms` | `id`, `name`, `emoji`, `color`, `is_group` | Salons de discussion |
| `messages` | `room_id`, `user_id`, `username`, `content`, `attachment_url`, `attachment_type` | Messages + pièces jointes |
| `read_state` | `user_id`, `room_id`, `last_read_at` | Suivi des messages lus (badges) |
| `purchases` | `user_id`, `course_id`, `amount`, `fedapay_transaction_id`, `status` | Achats de formations |

### Politiques RLS actives

- **profiles** : lecture ouverte aux authentifiés · écriture/mise à jour uniquement sur son propre profil (`auth.uid() = id`)
- **rooms** : lecture ouverte aux authentifiés · création ouverte aux authentifiés (bouton ＋)
- **messages** : lecture ouverte aux authentifiés · insertion uniquement en son propre nom (`auth.uid() = user_id`)
- **read_state** : lecture/écriture/mise à jour limitées à ses propres lignes (`auth.uid() = user_id`)
- **purchases** : lecture limitée à ses propres achats (`auth.uid() = user_id`) · aucune policy d'insertion côté client — seules les fonctions serverless (clé `service_role`, qui contourne la RLS) peuvent créer/mettre à jour un achat

Realtime activé sur `messages` pour l'affichage instantané.

Si tu dois relancer ce script un jour (nouvel environnement Supabase), il est
conçu pour s'exécuter sans erreur même si les tables existent déjà
(`if not exists`, `on conflict do nothing`, `drop policy if exists`).

---

## 8. Variables d'environnement Vercel (noms exacts confirmés)

| Variable | Utilisée par | Où la trouver |
|---|---|---|
| `SUPABASE_URL` | `/api/fedapay-checkout.js`, `/api/fedapay-webhook.js` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | idem | Supabase → Project Settings → API (clé **service_role**, jamais la clé anon) |
| `FEDAPAY_SECRET_KEY` | `/api/fedapay-checkout.js` | Tableau de bord FedaPay |
| `FEDAPAY_ENVIRONMENT` | idem (`sandbox` ou `live`) | — |
| `CLOUDINARY_CLOUD_NAME` | `/api/cloudinary-sign.js` | Tableau de bord Cloudinary |
| `CLOUDINARY_API_KEY` | idem | idem |
| `CLOUDINARY_API_SECRET` | idem | idem |
| `GOOGLE_CLIENT_ID` | Config Supabase (Authentication → Providers → Google), pas lu directement par le code Vercel | Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | idem | idem |
| `PUBLIC_SITE_URL` *(optionnel)* | `/api/fedapay-checkout.js` — sinon déduit automatiquement de l'URL de la requête | Ton domaine Vercel final |

Ces 9 variables sont déjà enregistrées dans ton projet Vercel (confirmé par
capture d'écran).

Dans `config.js` (fichier client, pas une variable Vercel) : remplace
`SUPABASE_URL` et `SUPABASE_ANON_KEY` par tes vraies valeurs — la clé anon est
publique par conception, protégée par les policies RLS ci-dessus.

---

## 9. Déploiement sur GitHub

1. Crée un nouveau dépôt (ex. `mahoutoplus`) sur [github.com/new](https://github.com/new), vide, sans README.
2. Sur ton ordinateur ou via GitHub mobile/Codespaces, place tous les fichiers de ce guide (section 1) dans un dossier local nommé `mahoutoplus`.
3. Depuis ce dossier :
   ```
   git init
   git add .
   git commit -m "MAHOUTO+ — version initiale de production"
   git branch -M main
   git remote add origin https://github.com/TON-COMPTE/mahoutoplus.git
   git push -u origin main
   ```
4. Vérifie sur GitHub que `config.js` ne contient PAS tes vraies clés Supabase si le dépôt est public (la clé anon seule est sans risque grâce à la RLS, mais évite quand même de committer des identifiants par réflexe).

---

## 10. Déploiement sur Vercel

1. Sur [vercel.com](https://vercel.com) → **Add New → Project**.
2. Importe le dépôt GitHub `mahoutoplus`.
3. Framework Preset : **Other** (site statique + fonctions `/api`) — Vercel détecte automatiquement `/api/*.js` comme fonctions serverless.
4. Vérifie que les 9 variables d'environnement de la section 8 sont bien présentes pour **Production et Preview** (déjà fait selon tes captures).
5. Clique **Deploy**.
6. Une fois déployé, note l'URL finale (ex. `mahoutoplus.vercel.app`) et mets-la à jour dans `PUBLIC_SITE_URL` si tu utilises cette variable.
7. Dans FedaPay → Webhooks, configure `https://TON-URL.vercel.app/api/fedapay-webhook`.
8. Dans Supabase → Authentication → URL Configuration, ajoute `https://TON-URL.vercel.app/discussions.html` aux Redirect URLs autorisées.

---

## 11. Tests finaux à effectuer

- [ ] L'app s'ouvre en HTTPS sur mobile, sans erreur console
- [ ] "Ajouter à l'écran d'accueil" propose bien l'icône M+
- [ ] **Messages** : connexion Google fonctionne et crée un profil automatiquement
- [ ] **Messages** : un message texte envoyé apparaît en temps réel sur un 2ᵉ appareil/onglet
- [ ] **Messages** : envoi d'une photo via 📎 fonctionne et s'affiche dans la conversation
- [ ] **School** : clic sur "Acheter" redirige vers une page de paiement FedaPay valide
- [ ] **School** : après paiement test (sandbox), le statut passe à "✅ Paiement confirmé" et le cours passe en "✓ Acquis"
- [ ] **MAHOUTO AI** : avec une clé OpenRouter valide, une question renvoie une vraie réponse
- [ ] **Profil** : modification du pseudo est bien sauvegardée après rechargement
- [ ] Mode hors-ligne : couper le réseau puis rouvrir l'app → la coquille (Accueil, nav) s'affiche quand même


---

## 12. Second domaine : MAJESTÉ PRESSE (majestepresse.com)

Le **même dépôt** sert deux sites. La marque est choisie **dans le navigateur d'après le nom d'hôte**
(`brand.js`) : `majestepresse.com` / `www.majestepresse.com` → « MAJESTÉ PRESSE » ; `mahouto.com`,
`www.mahouto.com`, `localhost` et tout hôte inconnu (aperçus Vercel…) → « MAHOUTO+ » (défaut).
Les deux sites partagent **le même projet Supabase** (mêmes comptes, mêmes tables).

> Tout ce qui suit se fait **hors du code**, dans les consoles concernées. Rien de cela n'est fait ni testé par le dépôt.

### 12.1 Organisation de l'hébergement
- [ ] **Recommandé : un second projet Vercel** relié au **même dépôt** GitHub (même branche `main`), avec le domaine `majestepresse.com`.
      Avantage : variables d'environnement et domaine propres à chaque site.
- [ ] Alternative : un seul projet Vercel avec les deux domaines. Dans ce cas, **ne définissez pas** `PUBLIC_SITE_URL`
      (le code retombe alors sur l'hôte de la requête, ce qui est correct pour les deux domaines).

### 12.2 Domaine chez l'hébergeur (Vercel → Settings → Domains)
- [ ] Ajouter `majestepresse.com` **et** `www.majestepresse.com` ; choisir lequel redirige vers l'autre.
- [ ] Chez le registrar, créer les enregistrements DNS demandés par Vercel (en général : `A` apex → valeur affichée par Vercel,
      `CNAME` de `www` → valeur affichée par Vercel). **Recopier les valeurs exactes affichées dans Vercel.**
- [ ] Attendre l'émission automatique du certificat HTTPS, puis ouvrir `https://majestepresse.com`.

### 12.3 Variables d'environnement du second projet Vercel (section 8 de ce guide)
- [ ] Mêmes valeurs que le premier projet : `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
      `FEDAPAY_SECRET_KEY`, `FEDAPAY_WEBHOOK_SECRET`, `FEDAPAY_ENVIRONMENT`, `CLOUDINARY_*`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`.
- [ ] `PUBLIC_SITE_URL` = `https://majestepresse.com` (second projet uniquement).
- [ ] Ne jamais mettre ces valeurs dans le dépôt (voir `.gitignore` et `.env.example`).

### 12.4 Supabase → Authentication → URL Configuration
- [ ] **Redirect URLs** : ajouter `https://majestepresse.com/**` et `https://www.majestepresse.com/**`
      (en gardant celles de mahouto.com). Le code redirige vers l'origine courante (`window.location.origin`).
- [ ] **Site URL** : il n'y en a **qu'une seule** par projet Supabase. Laissez celle de mahouto.com (ou choisissez-en une)
      ; l'autre domaine fonctionne grâce aux Redirect URLs.
- [ ] **Connexion par email (code à 6 chiffres)** : le modèle d'email doit afficher le code (`{{ .Token }}`) et ne pas
      dépendre de `{{ .SiteURL }}` : sinon les liens du mail pointeraient toujours vers le Site URL. Les emails portent
      la marque configurée dans Supabase (une seule par projet).

### 12.5 Connexion Google (Google Cloud Console → API et services → Identifiants)
- [ ] Client OAuth « Application Web » → **Origines JavaScript autorisées** : ajouter `https://majestepresse.com` et
      `https://www.majestepresse.com`.
- [ ] L'**URI de redirection autorisée** reste celle de Supabase (`https://<projet>.supabase.co/auth/v1/callback`) : inchangée.
- [ ] Écran de consentement OAuth → **Domaines autorisés** : ajouter `majestepresse.com`.
      Le nom d'application affiché par Google reste unique (celui de l'écran de consentement).

### 12.6 Paiements (FedaPay)
- [ ] Même compte FedaPay et même base : **un seul endpoint de webhook suffit** (`https://<domaine>/api/fedapay-webhook`).
      Évitez d'en déclarer deux : chaque paiement serait notifié deux fois (le traitement est idempotent, mais inutile).
- [ ] Les pages de retour de paiement utilisent le domaine de la requête (ou `PUBLIC_SITE_URL`) : tester un paiement
      **sandbox** depuis `majestepresse.com` (voir 12.9).

### 12.7 API MAJESTÉ Pro (serveur séparé : `ai.majestepresse.com`)
- [ ] Ajouter `https://majestepresse.com` et `https://www.majestepresse.com` aux **origines autorisées (CORS)** de ce serveur
      (aujourd'hui : `mahouto.com` et `www.mahouto.com`). Sans cela, le navigateur bloque les réponses du chat.
- [ ] Vérifier que ce serveur accepte les jetons Supabase émis depuis le second domaine (même projet Supabase).

### 12.8 Autres services
- [ ] **Cloudinary** : si des restrictions de domaines (Security → allowed fetch domains / referrers) sont actives, y ajouter
      `majestepresse.com`.
- [ ] **Notifications push** : les abonnements sont **propres à chaque domaine** ; l'utilisateur doit les réactiver sur
      `majestepresse.com`. Le sujet VAPID (`api/push.js`) reste `mailto:contact@mahouto.com` : à changer si besoin.
- [ ] Les sessions, caches et données locales sont **séparés par domaine** (origines distinctes) : l'utilisateur se reconnecte
      sur chaque site, et le service worker de chaque domaine a son propre cache.

### 12.9 Vérifications après mise en ligne (à faire à la main)
- [ ] `https://majestepresse.com` : nom « MAJESTÉ PRESSE », logo, onglets, aucun « MAHOUTO+ » visible.
- [ ] `https://mahouto.com` : **strictement inchangé** (apparence, textes, installation PWA).
- [ ] Installation PWA depuis `majestepresse.com` (nom, icône, couleur) ; vérifier que `manifest-majeste.json` est bien chargé
      (DevTools → Application → Manifest).
- [ ] Connexion Google et connexion par email (code) depuis `majestepresse.com`.
- [ ] Chat MAJESTÉ Pro depuis `majestepresse.com` (CORS, 12.7).
- [ ] Paiement sandbox, puis lien de partage `/p/<id>` (aperçu : nom du site = « MAJESTÉ PRESSE »).

### 12.10 À fournir pour finaliser la marque « MAJESTÉ PRESSE »
Le dépôt utilise des **valeurs de repli** (voir `brand.js`, objet `BRANDS.majeste`, et `manifest-majeste.json`) :
- [ ] **Logo officiel** (aujourd'hui : `assets/logo-majeste-presse.png`, déjà dans le dépôt, à confirmer).
- [ ] **Couleurs de marque** (aujourd'hui : mêmes valeurs que MAHOUTO+ : `theme_color` `#FFC107`, fond `#0A0A0A`).
- [ ] **Icônes** 192 / 512 / maskable, favicon, apple-touch-icon, écran de démarrage (aujourd'hui : ceux de MAHOUTO+).
- [ ] **Captures d'écran** de l'application pour l'installation (retirées du manifest Majesté : celles du dépôt montrent MAHOUTO+).
- [ ] **Slogan et sous-titre** : propositions actuelles « Informer • Former • Inspirer » et
      « La presse qui éclaire, le savoir qui élève. » (à valider ou remplacer).
