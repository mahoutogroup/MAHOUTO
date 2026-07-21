# MAHOUTO+ — Politique de Sécurité

**Dernière mise à jour:** 21 juillet 2026

---

## 🔐 Principes de Sécurité

MAHOUTO+ suit les meilleures pratiques de sécurité pour protéger les données et les transactions des utilisateurs africains.

### 1. Gestion des Clés API

#### ❌ À NE JAMAIS FAIRE

```javascript
// ❌ MAUVAIS : Clé API en dur dans le code
const FEDAPAY_KEY = "sk_live_abc123xyz";

// ❌ MAUVAIS : Clé API dans le fichier config.js (client)
window.MAHOUTO_CONFIG = {
  FEDAPAY_SECRET_KEY: "sk_live_abc123xyz"
};

// ❌ MAUVAIS : Commiter .env.local sur GitHub
git add .env.local
git commit -m "Add env vars"
```

#### ✅ À FAIRE

```javascript
// ✅ BON : Utiliser les variables d'environnement Vercel
const secretKey = process.env.FEDAPAY_SECRET_KEY;

// ✅ BON : Utiliser .env.local (ignoré par Git)
// .gitignore contient: .env.local

// ✅ BON : Documenter avec .env.example
// .env.example contient les noms de variables sans valeurs
```

### 2. Authentification

#### Google OAuth

```javascript
// ✅ Utiliser Supabase pour gérer Google OAuth
// Les tokens sont stockés de manière sécurisée dans Supabase
const { data, error } = await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    redirectTo: `${window.location.origin}/`
  }
});
```

#### Clés Supabase

- **`SUPABASE_ANON_KEY`** : Publique, utilisée par le client
  - ✅ Peut être exposée
  - ✅ Protégée par les policies RLS
  - ✅ À mettre dans `config.js`

- **`SUPABASE_SERVICE_ROLE_KEY`** : Secrète, utilisée côté serveur uniquement
  - ❌ Ne JAMAIS exposer au client
  - ❌ Ne JAMAIS mettre dans `config.js`
  - ✅ À mettre dans les variables Vercel
  - ✅ À utiliser uniquement dans `/api/*.js`

### 3. Paiements FedaPay

#### Sécurité du Webhook

```javascript
// ✅ BON : Vérifier la signature avant de traiter
import { Webhook } from "fedapay";

const event = Webhook.constructEvent(
  rawBody,
  signatureHeader,
  process.env.FEDAPAY_WEBHOOK_SECRET
);

// ✅ BON : Ne JAMAIS faire confiance aux données du webhook
// Toujours vérifier auprès de l'API FedaPay
const officialTransaction = await Transaction.retrieve(transactionId);
const officialStatus = officialTransaction.status;
const officialAmount = officialTransaction.amount;

// ❌ MAUVAIS : Utiliser directement le statut du webhook
const status = event.entity.status; // ❌ Attaquant peut forger ceci
```

#### Protection Anti-Double-Paiement

```javascript
// ✅ BON : Vérifier que le paiement n'a pas déjà été traité
if (purchase.status === "paid") {
  return res.status(200).json({ received: true, already_paid: true });
}

// ✅ BON : Dédoublonner les événements webhook
const { error: dedupError } = await supabase
  .from("webhook_events")
  .insert({ id: eventId, event_type: eventType });

if (dedupError && dedupError.code === "23505") {
  // Événement déjà traité
  return res.status(200).json({ received: true, duplicate: true });
}

// ✅ BON : Vérifier le montant exact
if (officialAmount !== purchase.amount) {
  return res.status(400).json({ error: "Montant incohérent" });
}
```

### 4. Supabase RLS (Row Level Security)

#### Policies Correctes

```sql
-- ✅ BON : Lecture ouverte, écriture limitée
CREATE POLICY "Lecture profils" ON profiles
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Ecriture profil personnel" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- ✅ BON : Lecture limitée à ses propres achats
CREATE POLICY "Lecture achats personnels" ON purchases
  FOR SELECT USING (auth.uid() = user_id);

-- ❌ MAUVAIS : Aucune policy (données publiques)
-- ❌ MAUVAIS : Policy trop permissive
CREATE POLICY "Lecture tous les achats" ON purchases
  FOR SELECT USING (true); -- ❌ N'importe qui peut voir tous les achats
```

#### Vérification des Policies

```bash
# Vérifier que RLS est activée
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public';

# Vérifier les policies
SELECT schemaname, tablename, policyname, permissive, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public';
```

### 5. Cloudinary (Stockage de Fichiers)

#### Signature Sécurisée

```javascript
// ✅ BON : Générer la signature côté serveur
// Jamais exposer la clé secrète Cloudinary au client
const signature = crypto
  .createHash("sha1")
  .update(`folder=mahoutoplus&timestamp=${timestamp}${apiSecret}`)
  .digest("hex");

// ✅ BON : Retourner uniquement les paramètres signés
return res.json({
  cloudName,
  apiKey,
  timestamp,
  folder,
  signature,
  uploadUrl: "https://api.cloudinary.com/v1_1/.../auto/upload"
});

// ❌ MAUVAIS : Exposer la clé secrète
return res.json({
  apiSecret: process.env.CLOUDINARY_API_SECRET // ❌ DANGER!
});
```

#### Validation des Fichiers

```javascript
// ✅ BON : Valider le type et la taille côté client
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "video/mp4"];

if (file.size > MAX_FILE_SIZE) {
  alert("Fichier trop volumineux");
  return;
}

if (!ALLOWED_TYPES.includes(file.type)) {
  alert("Type de fichier non autorisé");
  return;
}

// ✅ BON : Valider aussi côté serveur (Cloudinary)
// Utiliser les transformations Cloudinary pour sécuriser
```

### 6. Validation des Données

#### Montants de Paiement

```javascript
// ✅ BON : Valider le montant
function validateAmount(amount) {
  const num = Number(amount);
  
  // Montant doit être un nombre positif
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error("Montant invalide");
  }
  
  // Montant doit être raisonnable (< 1 million XOF)
  if (num > 1000000) {
    throw new Error("Montant trop élevé");
  }
  
  // Montant doit être un entier (centimes)
  if (!Number.isInteger(num)) {
    throw new Error("Montant doit être un entier");
  }
  
  return num;
}

// ❌ MAUVAIS : Pas de validation
const amount = req.body.amount; // Attaquant peut envoyer n'importe quoi
```

#### Identifiants Utilisateur

```javascript
// ✅ BON : Vérifier que l'utilisateur modifie ses propres données
const userId = req.user.id; // Depuis le token authentifié

const { error } = await supabase
  .from("purchases")
  .update(updatePayload)
  .eq("id", purchase.id)
  .eq("user_id", userId); // ✅ Vérifier l'utilisateur

// ❌ MAUVAIS : Accepter l'user_id du client
const userId = req.body.user_id; // ❌ Attaquant peut modifier d'autres utilisateurs
```

### 7. Gestion des Erreurs

#### À NE PAS EXPOSER

```javascript
// ❌ MAUVAIS : Exposer les détails d'erreur
return res.status(500).json({
  error: "Database connection failed at 192.168.1.1:5432"
});

// ❌ MAUVAIS : Exposer les stack traces
return res.status(500).json({
  error: err.stack
});
```

#### À FAIRE

```javascript
// ✅ BON : Message d'erreur générique pour l'utilisateur
return res.status(500).json({
  error: "Une erreur s'est produite. Veuillez réessayer."
});

// ✅ BON : Journaliser les détails côté serveur
console.error("Database error:", {
  error: err.message,
  code: err.code,
  timestamp: new Date().toISOString()
});
```

### 8. CORS (Cross-Origin Resource Sharing)

#### Configuration Vercel

```javascript
// ✅ BON : Configurer CORS correctement dans Vercel
// vercel.json
{
  "headers": [
    {
      "source": "/api/:path*",
      "headers": [
        { "key": "Access-Control-Allow-Credentials", "value": "true" },
        { "key": "Access-Control-Allow-Origin", "value": "https://mahouto.vercel.app" },
        { "key": "Access-Control-Allow-Methods", "value": "GET,OPTIONS,PATCH,DELETE,POST,PUT" },
        { "key": "Access-Control-Allow-Headers", "value": "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version" }
      ]
    }
  ]
}
```

### 9. HTTPS et Certificats SSL

#### ✅ À FAIRE

- ✅ Toujours utiliser HTTPS en production
- ✅ Vercel fournit automatiquement les certificats SSL
- ✅ Rediriger HTTP vers HTTPS

#### ❌ À NE PAS FAIRE

- ❌ Utiliser HTTP en production
- ❌ Désactiver la vérification SSL
- ❌ Utiliser des certificats auto-signés

### 10. Logging et Monitoring

#### Bonnes Pratiques

```javascript
// ✅ BON : Journaliser les événements importants
function log(level, message, extra = {}) {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...extra
  };
  
  if (level === "error") {
    console.error(JSON.stringify(entry));
    // Envoyer à un service de monitoring (Sentry, LogRocket, etc.)
  } else {
    console.log(JSON.stringify(entry));
  }
}

// Exemples
log("info", "Paiement traité", { transactionId, userId });
log("error", "Webhook FedaPay invalide", { reason: "Signature invalide" });
log("warn", "Montant anormal détecté", { amount, userId });
```

#### Événements à Logger

- ✅ Authentification (connexion, déconnexion, erreurs)
- ✅ Paiements (création, confirmation, erreurs)
- ✅ Accès aux données sensibles
- ✅ Erreurs serveur
- ✅ Tentatives d'accès non autorisé

---

## 📋 Checklist de Sécurité Avant Production

- [ ] Aucune clé API en dur dans le code
- [ ] `.env.local` dans `.gitignore`
- [ ] `.env.example` documenté
- [ ] Toutes les variables Vercel configurées
- [ ] RLS Supabase activée sur toutes les tables sensibles
- [ ] Policies RLS vérifiées
- [ ] Webhook FedaPay configuré correctement
- [ ] Signature FedaPay vérifiée
- [ ] Montants validés
- [ ] Protection anti-double-paiement testée
- [ ] Cloudinary signature sécurisée
- [ ] HTTPS activé
- [ ] CORS configuré correctement
- [ ] Logging en place
- [ ] Tests de sécurité effectués
- [ ] Audit de code effectué
- [ ] Dépendances à jour

---

## 🚨 Incident Response

### Si une clé API est compromise

1. **Immédiatement**
   - Révoquer la clé compromise
   - Générer une nouvelle clé
   - Mettre à jour les variables Vercel
   - Redéployer l'application

2. **Auditer**
   - Vérifier les logs d'accès
   - Identifier les transactions suspectes
   - Contacter les utilisateurs affectés

3. **Documenter**
   - Créer un incident report
   - Analyser la cause racine
   - Implémenter des mesures préventives

### Si une transaction frauduleuse est détectée

1. **Immédiatement**
   - Bloquer l'utilisateur/compte
   - Marquer la transaction comme frauduleuse
   - Notifier l'utilisateur

2. **Auditer**
   - Vérifier les autres transactions de cet utilisateur
   - Vérifier les logs d'accès
   - Identifier le vecteur d'attaque

3. **Corriger**
   - Implémenter des contrôles supplémentaires
   - Renforcer la validation
   - Mettre à jour les policies

---

## 📚 Ressources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Supabase Security](https://supabase.com/docs/guides/security)
- [FedaPay Security](https://docs.fedapay.com/security)
- [Cloudinary Security](https://cloudinary.com/documentation/security)
- [Vercel Security](https://vercel.com/security)

---

## 📞 Signaler une Faille de Sécurité

Si vous découvrez une faille de sécurité, veuillez envoyer un email à **security@mahouto.com** avec :

- Description détaillée de la faille
- Étapes pour reproduire
- Impact potentiel
- Votre nom et contact

**Ne pas** ouvrir une issue publique sur GitHub.

---

**MAHOUTO+** — *Sécurité d'abord*

Dernière mise à jour : 21 juillet 2026
