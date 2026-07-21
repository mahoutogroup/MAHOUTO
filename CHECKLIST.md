# MAHOUTO+ — Checklist de Déploiement Production

**Avant de déployer en production, vérifier tous les points ci-dessous.**

---

## ✅ Configuration Supabase

- [ ] Projet Supabase créé
- [ ] `SUPABASE_URL` copié dans Vercel
- [ ] `SUPABASE_ANON_KEY` copié dans Vercel
- [ ] `SUPABASE_SERVICE_ROLE_KEY` copié dans Vercel
- [ ] Schéma SQL exécuté (`supabase-schema.sql`)
- [ ] Tables vérifiées : `profiles`, `rooms`, `messages`, `read_state`, `purchases`, `webhook_events`
- [ ] RLS activée sur toutes les tables
- [ ] Policies RLS vérifiées
- [ ] Google OAuth configuré dans Supabase
- [ ] Realtime activé sur `messages`

---

## ✅ Configuration FedaPay

- [ ] Compte FedaPay créé
- [ ] `FEDAPAY_PUBLIC_KEY` copié dans Vercel
- [ ] `FEDAPAY_SECRET_KEY` copié dans Vercel
- [ ] `FEDAPAY_WEBHOOK_SECRET` copié dans Vercel
- [ ] `FEDAPAY_ENVIRONMENT` défini à `sandbox` (ou `live` en production)
- [ ] Webhook configuré dans FedaPay Dashboard
  - URL: `https://your-domain.vercel.app/api/fedapay-webhook`
  - Événements: `transaction.approved`, `transaction.declined`, `transaction.canceled`
- [ ] Webhook testé avec un paiement de test

---

## ✅ Configuration Cloudinary

- [ ] Compte Cloudinary créé
- [ ] `CLOUDINARY_CLOUD_NAME` copié dans Vercel
- [ ] `CLOUDINARY_API_KEY` copié dans Vercel
- [ ] `CLOUDINARY_API_SECRET` copié dans Vercel
- [ ] Dossier `mahoutoplus` créé dans Cloudinary (optionnel)

---

## ✅ Configuration Google OAuth

- [ ] Projet Google Cloud créé
- [ ] OAuth 2.0 Client ID créé
- [ ] `GOOGLE_CLIENT_ID` copié dans Vercel
- [ ] `GOOGLE_CLIENT_SECRET` copié dans Vercel
- [ ] URI autorisés configurés dans Google Cloud
- [ ] Google OAuth configuré dans Supabase

---

## ✅ Code Source

- [ ] `config.js` rempli avec vraies valeurs Supabase
- [ ] Aucune clé API en dur dans le code
- [ ] `.env.local` ignoré par Git (voir `.gitignore`)
- [ ] `.env.example` documenté
- [ ] `README.md` à jour
- [ ] `SECURITY.md` à jour
- [ ] `DEPLOIEMENT.md` à jour
- [ ] Tous les fichiers HTML valides
- [ ] Tous les fichiers CSS valides
- [ ] Tous les fichiers JS valides

---

## ✅ PWA

- [ ] `manifest.json` valide
- [ ] Icônes présentes : `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`
- [ ] Service Worker (`sw.js`) fonctionnel
- [ ] Installation PWA testée sur Android
- [ ] Mode hors connexion testé

---

## ✅ Vercel

- [ ] Projet créé sur Vercel
- [ ] Dépôt GitHub connecté
- [ ] Toutes les variables d'environnement configurées
- [ ] Domaine personnalisé configuré (optionnel)
- [ ] Certificat SSL activé (automatique)
- [ ] Build réussi
- [ ] Déploiement réussi

---

## ✅ Tests Fonctionnels

### Authentification
- [ ] Google Sign-In fonctionne
- [ ] Email/Password fonctionne
- [ ] Session persiste après rafraîchissement
- [ ] Déconnexion fonctionne

### Messagerie
- [ ] Créer un salon fonctionne
- [ ] Envoyer un message fonctionne
- [ ] Messages apparaissent en temps réel
- [ ] Pièces jointes fonctionnent
- [ ] Badges de messages non lus fonctionnent

### Paiements (Mode Sandbox)
- [ ] Créer une transaction FedaPay fonctionne
- [ ] Redirection vers paiement fonctionne
- [ ] Confirmation de paiement fonctionne
- [ ] Statut de paiement mis à jour dans Supabase
- [ ] Webhook reçu et traité correctement

### IA
- [ ] Chat IA fonctionne
- [ ] Réponses générées correctement
- [ ] Historique sauvegardé (si implémenté)

### Profil
- [ ] Modifier le pseudo fonctionne
- [ ] Photo de profil s'affiche
- [ ] Historique des achats s'affiche (si implémenté)

---

## ✅ Tests de Sécurité

- [ ] Aucune clé API exposée dans les réponses API
- [ ] Aucune clé API visible dans les logs
- [ ] CORS configuré correctement
- [ ] Signature FedaPay validée
- [ ] Montants validés
- [ ] RLS Supabase fonctionne
- [ ] Utilisateur ne peut pas voir les données d'autres utilisateurs
- [ ] Utilisateur ne peut pas modifier les données d'autres utilisateurs
- [ ] Injection SQL impossible
- [ ] XSS impossible

---

## ✅ Performance

- [ ] Lighthouse score > 80 (Performance)
- [ ] Lighthouse score > 90 (Accessibility)
- [ ] Lighthouse score > 90 (Best Practices)
- [ ] Lighthouse score > 90 (SEO)
- [ ] Temps de chargement < 3s
- [ ] Taille des assets optimisée
- [ ] Images optimisées
- [ ] CSS minifié
- [ ] JS minifié

---

## ✅ Monitoring

- [ ] Logging configuré
- [ ] Erreurs loggées correctement
- [ ] Paiements loggés correctement
- [ ] Webhooks loggés correctement
- [ ] Service de monitoring configuré (optionnel : Sentry, LogRocket, etc.)

---

## ✅ Documentation

- [ ] README.md complet
- [ ] SECURITY.md complet
- [ ] DEPLOIEMENT.md complet
- [ ] .env.example documenté
- [ ] Code commenté (sections complexes)
- [ ] API documentée

---

## ✅ Avant le Go-Live

- [ ] Backup Supabase effectué
- [ ] Plan de rollback préparé
- [ ] Équipe support informée
- [ ] Utilisateurs informés de la date de lancement
- [ ] Monitoring en place
- [ ] Alertes configurées

---

## 🚀 Déploiement

1. **Vérifier tous les points ci-dessus**
2. **Faire un dernier test complet**
3. **Créer un commit final** : `git commit -m "Production ready"`
4. **Pousser sur GitHub** : `git push origin main`
5. **Vercel déploie automatiquement**
6. **Vérifier le déploiement** : Ouvrir l'URL Vercel
7. **Tester en production**
8. **Monitorer les logs**

---

## 📞 En Cas de Problème

1. Vérifier les logs Vercel : `vercel logs`
2. Vérifier les logs Supabase
3. Vérifier les logs FedaPay
4. Vérifier les erreurs dans la console du navigateur
5. Contacter le support

---

**Dernière mise à jour:** 21 juillet 2026

**Status:** ⏳ En attente de déploiement
