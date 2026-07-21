# MAHOUTO+ — Configuration des Variables d'Environnement Vercel

**Important:** Toutes les variables ci-dessous doivent être configurées dans Vercel > Project Settings > Environment Variables

## Variables Requises

### 1. Supabase

```
SUPABASE_URL
Description: URL de votre projet Supabase
Où trouver: Supabase Dashboard > Project Settings > API > Project URL
Exemple: https://your-project.supabase.co
```

```
SUPABASE_ANON_KEY
Description: Clé anonyme Supabase (publique, protégée par RLS)
Où trouver: Supabase Dashboard > Project Settings > API > anon key
Exemple: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

```
SUPABASE_SERVICE_ROLE_KEY
Description: Clé service role (SECRÈTE, côté serveur uniquement)
Où trouver: Supabase Dashboard > Project Settings > API > service_role key
Exemple: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
⚠️ JAMAIS exposer cette clé au client
```

### 2. FedaPay (Paiements)

```
FEDAPAY_PUBLIC_KEY
Description: Clé publique FedaPay
Où trouver: FedaPay Dashboard > API Keys
```

```
FEDAPAY_SECRET_KEY
Description: Clé secrète FedaPay (côté serveur uniquement)
Où trouver: FedaPay Dashboard > API Keys
⚠️ JAMAIS exposer cette clé au client
```

```
FEDAPAY_WEBHOOK_SECRET
Description: Secret pour valider les webhooks FedaPay
Où trouver: FedaPay Dashboard > Webhooks > Click to reveal
⚠️ CRITIQUE pour la sécurité des paiements
```

```
FEDAPAY_ENVIRONMENT
Description: Environnement FedaPay
Valeurs: "sandbox" ou "live"
Défaut: "sandbox"
```

### 3. Cloudinary (Stockage de Fichiers)

```
CLOUDINARY_CLOUD_NAME
Description: Nom du cloud Cloudinary
Où trouver: Cloudinary Dashboard > Settings > Cloud Name
```

```
CLOUDINARY_API_KEY
Description: Clé API Cloudinary
Où trouver: Cloudinary Dashboard > Settings > API Keys
```

```
CLOUDINARY_API_SECRET
Description: Secret API Cloudinary (côté serveur uniquement)
Où trouver: Cloudinary Dashboard > Settings > API Keys
⚠️ JAMAIS exposer cette clé au client
```

### 4. Google OAuth

```
GOOGLE_CLIENT_ID
Description: Client ID Google OAuth
Où trouver: Google Cloud Console > Credentials > OAuth 2.0 Client ID
```

```
GOOGLE_CLIENT_SECRET
Description: Secret Google OAuth
Où trouver: Google Cloud Console > Credentials > OAuth 2.0 Client ID
```

### 5. Configuration Générale

```
PUBLIC_SITE_URL
Description: URL publique de l'application
Exemple: https://mahouto.vercel.app
Utilisé pour: Callbacks FedaPay, redirects OAuth
```

```
NODE_ENV
Description: Environnement Node.js
Valeurs: "development" ou "production"
Défaut: "production" (défini automatiquement par Vercel)
```

## Checklist de Configuration Vercel

- [ ] Créer un projet Vercel
- [ ] Connecter le dépôt GitHub
- [ ] Ajouter toutes les variables ci-dessus dans Project Settings > Environment Variables
- [ ] Vérifier que les variables sont présentes dans tous les environments (Production, Preview, Development)
- [ ] Redéployer après avoir ajouté les variables
- [ ] Tester le déploiement avec un paiement de test

## Sécurité

### Variables Publiques (OK d'exposer)
- `SUPABASE_URL` — Publique par design
- `SUPABASE_ANON_KEY` — Protégée par RLS Supabase
- `CLOUDINARY_CLOUD_NAME` — Publique
- `GOOGLE_CLIENT_ID` — Publique

### Variables Secrètes (JAMAIS exposer)
- `SUPABASE_SERVICE_ROLE_KEY` — Côté serveur uniquement
- `FEDAPAY_SECRET_KEY` — Côté serveur uniquement
- `FEDAPAY_WEBHOOK_SECRET` — Côté serveur uniquement
- `CLOUDINARY_API_SECRET` — Côté serveur uniquement
- `GOOGLE_CLIENT_SECRET` — Côté serveur uniquement

## Vérification

Pour vérifier que les variables sont correctement configurées :

1. Ouvrir Vercel > Project Settings > Environment Variables
2. Vérifier que toutes les variables sont présentes
3. Vérifier que les variables secrètes ne sont pas visibles en clair
4. Redéployer le projet
5. Tester chaque fonctionnalité (authentification, paiements, upload)

## Dépannage

### "FEDAPAY_SECRET_KEY manquant"
- Vérifier que `FEDAPAY_SECRET_KEY` est configurée dans Vercel
- Vérifier qu'elle n'est pas vide
- Redéployer le projet

### "SUPABASE_URL invalide"
- Vérifier le format : `https://your-project.supabase.co`
- Vérifier qu'il n'y a pas d'espace avant/après
- Vérifier que c'est la bonne URL

### "Webhook FedaPay rejeté"
- Vérifier que `FEDAPAY_WEBHOOK_SECRET` est correct
- Vérifier que l'URL du webhook est correcte dans FedaPay Dashboard
- Vérifier que le webhook est en mode "live" si en production

## Support

Pour toute question sur la configuration, consultez :
- `README.md` — Guide complet
- `SECURITY.md` — Politique de sécurité
- `DEPLOIEMENT.md` — Guide de déploiement

---

**Dernière mise à jour:** 21 juillet 2026
