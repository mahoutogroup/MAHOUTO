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
