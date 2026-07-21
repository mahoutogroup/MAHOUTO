# MAHOUTO+ — Super Application Africaine

**L'Intelligence Artificielle, la Formation Professionnelle et le Commerce Numérique réunis dans une seule application.**

![MAHOUTO+](./icons/icon-512.png)

---

## 📋 Table des Matières

- [Vue d'ensemble](#vue-densemble)
- [Fonctionnalités](#fonctionnalités)
- [Architecture](#architecture)
- [Installation](#installation)
- [Configuration](#configuration)
- [Déploiement](#déploiement)
- [Sécurité](#sécurité)
- [Contribution](#contribution)

---

## 🎯 Vue d'ensemble

MAHOUTO+ est une **Progressive Web App (PWA)** conçue pour les utilisateurs africains, offrant :

- **🤖 Intelligence Artificielle** : Chat IA, traduction, programmation, génération de prompts
- **📚 Formation Professionnelle** : Cours, vidéos, quiz, examens, certificats numériques
- **💬 Messagerie Temps Réel** : Salons publics, messages privés, partage de fichiers
- **🛍️ Marketplace** : Produits, services, formations avec paiements sécurisés
- **👤 Profils Utilisateurs** : Pseudo, historique, certificats, QR codes

### Caractéristiques Techniques

- ✅ **PWA** : Installation sur smartphone, mode hors connexion
- ✅ **Mobile-First** : Design responsive optimisé pour petits écrans
- ✅ **Sécurisé** : Authentification Google, paiements FedaPay sécurisés, RLS Supabase
- ✅ **Temps Réel** : Messagerie instantanée avec Supabase Realtime
- ✅ **Scalable** : Architecture serverless sur Vercel

---

## ✨ Fonctionnalités

### MAHOUTO AI
- Chat avec IA (OpenRouter)
- Traduction automatique
- Assistance à la programmation
- Génération de prompts
- Assistance pédagogique
- Analyse de documents PDF

### MAHOUTO SCHOOL
- Catalogue de formations
- Cours, vidéos, PDF
- Quiz et examens
- Système de notes
- Certificats numériques
- Paiements via FedaPay (MTN, Moov, Cartes bancaires)

### MESSAGERIE
- Salons publics
- Messages privés
- Groupes
- Partage de photos, vidéos, documents
- Badges de messages non lus
- Temps réel

### MARKETPLACE
- Catalogue de produits
- Panier et paiement
- Promotions et codes promo
- Facturation
- Historique des achats

### PROFILS
- Photo de profil
- Pseudo modifiable
- Historique des achats
- Certificats et formations suivies
- QR code personnel

---

## 🏗️ Architecture

```
mahoutoplus/
├── index.html              # Accueil
├── discussions.html        # Salons de discussion
├── chat.html              # Messagerie
├── ai.html                # Assistant IA
├── school.html            # Formations
├── profil.html            # Profil utilisateur
├── config.js              # Configuration Supabase
├── theme.css              # Design system
├── manifest.json          # PWA manifest
├── sw.js                  # Service Worker
├── api/
│   ├── fedapay-checkout.js      # Création de paiements
│   ├── fedapay-webhook.js       # Confirmation de paiements
│   └── cloudinary-sign.js       # Upload de fichiers
├── icons/
│   ├── icon-192.png       # Icône 192x192
│   ├── icon-512.png       # Icône 512x512
│   └── icon-maskable-512.png    # Icône maskable
└── supabase-schema.sql    # Schéma base de données
```

### Stack Technologique

| Composant | Technologie |
|-----------|-------------|
| Frontend | HTML5, CSS3, JavaScript (Vanilla) |
| Backend | Vercel Serverless Functions |
| Base de données | Supabase (PostgreSQL) |
| Authentification | Google OAuth, Email/Password |
| Paiements | FedaPay API |
| Stockage fichiers | Cloudinary |
| IA | OpenRouter |
| PWA | Service Worker, Manifest |

---

## 🚀 Installation

### Prérequis

- Node.js 16+ (pour le développement local)
- Compte Supabase
- Compte FedaPay
- Compte Cloudinary
- Compte Google Cloud (pour OAuth)
- Compte OpenRouter (optionnel, les utilisateurs peuvent fournir leur clé)

### Étapes

1. **Cloner le dépôt**
   ```bash
   git clone https://github.com/mahoutogroup/MAHOUTO.git
   cd mahoutoplus
   ```

2. **Installer les dépendances**
   ```bash
   npm install
   ```

3. **Configurer les variables d'environnement**
   ```bash
   cp .env.example .env.local
   # Éditer .env.local avec vos vraies valeurs
   ```

4. **Remplir config.js**
   ```javascript
   // config.js
   window.MAHOUTO_CONFIG = {
     SUPABASE_URL: "https://your-project.supabase.co",
     SUPABASE_ANON_KEY: "your-anon-key"
   };
   ```

5. **Exécuter le schéma Supabase**
   - Aller sur Supabase Dashboard > SQL Editor
   - Copier-coller le contenu de `supabase-schema.sql`
   - Exécuter

6. **Démarrer le serveur local (optionnel)**
   ```bash
   npm run dev
   # Ou utiliser un serveur HTTP simple:
   python3 -m http.server 8000
   # Puis ouvrir http://localhost:8000
   ```

---

## ⚙️ Configuration

### Supabase

1. Créer un projet Supabase
2. Copier `SUPABASE_URL` et `SUPABASE_ANON_KEY` dans `config.js`
3. Exécuter `supabase-schema.sql` dans l'éditeur SQL
4. Configurer Google OAuth dans Authentication > Providers

### FedaPay

1. Créer un compte FedaPay
2. Générer les clés API
3. Ajouter les variables à Vercel:
   - `FEDAPAY_SECRET_KEY`
   - `FEDAPAY_WEBHOOK_SECRET`
   - `FEDAPAY_ENVIRONMENT` (sandbox ou live)
4. Configurer le webhook:
   - URL: `https://your-domain.vercel.app/api/fedapay-webhook`
   - Événements: `transaction.approved`, `transaction.declined`, `transaction.canceled`

### Cloudinary

1. Créer un compte Cloudinary
2. Ajouter les variables à Vercel:
   - `CLOUDINARY_CLOUD_NAME`
   - `CLOUDINARY_API_KEY`
   - `CLOUDINARY_API_SECRET`

### Google OAuth

1. Créer un projet Google Cloud
2. Créer des identifiants OAuth 2.0 (Client ID + Secret)
3. Ajouter les variables à Vercel:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
4. Configurer dans Supabase > Authentication > Providers > Google

---

## 🌐 Déploiement

### Sur Vercel (Recommandé)

1. **Pousser sur GitHub**
   ```bash
   git add .
   git commit -m "Initial commit"
   git push origin main
   ```

2. **Connecter à Vercel**
   - Aller sur vercel.com
   - Cliquer "New Project"
   - Sélectionner le dépôt GitHub
   - Configurer les variables d'environnement
   - Cliquer "Deploy"

3. **Configurer le domaine**
   - Vercel > Project Settings > Domains
   - Ajouter votre domaine personnalisé

### Variables d'Environnement Vercel

Ajouter dans Vercel > Project Settings > Environment Variables:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
FEDAPAY_PUBLIC_KEY=your-public-key
FEDAPAY_SECRET_KEY=your-secret-key
FEDAPAY_WEBHOOK_SECRET=your-webhook-secret
FEDAPAY_ENVIRONMENT=sandbox
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
PUBLIC_SITE_URL=https://your-domain.vercel.app
```

---

## 🔒 Sécurité

### Principes Fondamentaux

1. **Aucune clé API en dur** : Toutes les clés sensibles sont dans les variables d'environnement Vercel
2. **RLS Supabase** : Chaque utilisateur ne peut voir/modifier que ses propres données
3. **Webhook sécurisé** : Les paiements sont vérifiés directement auprès de FedaPay
4. **Protection anti-rejeu** : Les événements webhook sont dédoublonnés
5. **Validation des montants** : Chaque paiement est vérifié avant confirmation

### Checklist de Sécurité

- ✅ Vérifier que `.env.local` n'est jamais commité (voir `.gitignore`)
- ✅ Vérifier que `SUPABASE_SERVICE_ROLE_KEY` n'est utilisée que côté serveur
- ✅ Vérifier que les webhooks FedaPay sont correctement configurés
- ✅ Tester la validation des montants
- ✅ Vérifier les policies RLS Supabase
- ✅ Tester l'authentification Google
- ✅ Vérifier que Cloudinary ne stocke que les fichiers autorisés

### Rapports de Sécurité

Si vous découvrez une faille de sécurité, veuillez envoyer un email à `security@mahouto.com` (à remplacer par votre adresse).

---

## 🧪 Tests

### Tests Manuels

1. **Installation PWA**
   - Ouvrir sur Android
   - Cliquer "Installer l'app"
   - Vérifier que l'app s'installe

2. **Authentification**
   - Tester Google Sign-In
   - Tester Email/Password
   - Vérifier la persistance de session

3. **Messagerie**
   - Créer un salon
   - Envoyer des messages
   - Vérifier le temps réel
   - Tester les pièces jointes

4. **Paiements**
   - Tester en mode sandbox FedaPay
   - Vérifier la création de transaction
   - Vérifier la confirmation de paiement

5. **Mode Hors Connexion**
   - Couper la connexion réseau
   - Vérifier que l'app fonctionne partiellement
   - Rétablir la connexion
   - Vérifier la synchronisation

### Lighthouse

```bash
# Générer un rapport Lighthouse
npm run lighthouse
```

Cibles:
- Performance: > 80
- Accessibility: > 90
- Best Practices: > 90
- SEO: > 90

---

## 📦 Dépendances

```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "fedapay": "^1.2.5"
  }
}
```

### Optionnelles (pour développement)

- `@vercel/cli` : Déploiement local
- `lighthouse` : Audit de performance

---

## 🤝 Contribution

Les contributions sont bienvenues ! Veuillez :

1. Forker le dépôt
2. Créer une branche (`git checkout -b feature/amazing-feature`)
3. Commiter vos changements (`git commit -m 'Add amazing feature'`)
4. Pousser vers la branche (`git push origin feature/amazing-feature`)
5. Ouvrir une Pull Request

### Conventions de Code

- Utiliser des noms de variables explicites en français
- Ajouter des commentaires pour les sections complexes
- Tester avant de soumettre une PR
- Suivre le style CSS existant

---

## 📄 Licence

Ce projet est sous licence MIT. Voir `LICENSE` pour plus de détails.

---

## 📞 Support

- **Documentation** : Voir `DEPLOIEMENT.md`
- **Sécurité** : Voir `SECURITY.md`
- **Issues** : GitHub Issues
- **Email** : support@mahouto.com (à remplacer)

---

## 🎉 Remerciements

Merci à tous les contributeurs et à la communauté africaine pour leur soutien !

---

**MAHOUTO+** — *Transforming Africa Through Technology*

Dernière mise à jour : 21 juillet 2026
