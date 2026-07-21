# MAHOUTO+ — Guide de Contribution

Merci de votre intérêt pour contribuer à MAHOUTO+ ! Ce document explique comment contribuer de manière efficace et sécurisée.

## Code de Conduite

Tous les contributeurs doivent respecter un code de conduite professionnel et inclusif.

## Comment Contribuer

### 1. Signaler un Bug

Créez une issue GitHub avec :
- Description claire du bug
- Étapes pour reproduire
- Résultat attendu vs résultat actuel
- Environnement (navigateur, appareil, OS)

### 2. Proposer une Fonctionnalité

Créez une issue GitHub avec :
- Description de la fonctionnalité
- Cas d'usage
- Bénéfices pour les utilisateurs
- Complexité estimée

### 3. Soumettre du Code

#### Préparation

1. Fork le dépôt
2. Créer une branche : `git checkout -b feature/ma-fonctionnalite`
3. Faire les modifications
4. Tester localement

#### Conventions de Code

- **JavaScript** : Utiliser ES6+, camelCase pour les variables
- **HTML** : Indentation 2 espaces, sémantique HTML5
- **CSS** : BEM naming convention, mobile-first
- **Commits** : Messages clairs et descriptifs

```bash
# Bons messages de commit
git commit -m "feat: Add user authentication"
git commit -m "fix: Correct webhook signature validation"
git commit -m "docs: Update README with new features"
git commit -m "style: Format CSS according to BEM"
git commit -m "refactor: Simplify payment logic"
git commit -m "perf: Optimize image loading"
```

#### Vérifications de Sécurité

Avant de soumettre, vérifier :

```bash
# Aucune clé API en dur
grep -r "sk_live\|sk_test\|Bearer\|FEDAPAY_SECRET" . --include="*.js" --include="*.html"

# Aucun fichier sensible
ls -la | grep ".env"

# Pas de node_modules
ls -la | grep "node_modules"
```

#### Pull Request

1. Pousser la branche : `git push origin feature/ma-fonctionnalite`
2. Créer une Pull Request sur GitHub
3. Décrire les modifications
4. Attendre la review

### 4. Standards de Qualité

#### Tests

- Tester localement avant de soumettre
- Vérifier sur mobile (Android et iPhone)
- Tester en mode hors connexion (PWA)
- Tester les paiements en sandbox

#### Documentation

- Mettre à jour README.md si nécessaire
- Ajouter des commentaires pour le code complexe
- Documenter les nouvelles variables d'environnement

#### Performance

- Lighthouse score > 80 (Performance)
- Temps de chargement < 3s
- Pas de fuites mémoire

#### Sécurité

- Pas de clés API en dur
- Validation des données côté serveur
- Gestion des erreurs appropriée
- Pas d'exposition d'informations sensibles

## Structure du Projet

```
mahoutoplus/
├── index.html, *.html      # Pages de l'application
├── api/                    # Fonctions serverless Vercel
│   ├── fedapay-*.js       # Paiements
│   ├── cloudinary-*.js    # Stockage
│   ├── utils-*.js         # Utilitaires
├── icons/                  # Icônes PWA
├── config.js              # Configuration
├── theme.css              # Styles
├── sw.js                  # Service Worker
├── manifest.json          # PWA manifest
├── supabase-schema.sql    # Schéma base de données
└── Documentation/         # Guides et documentation
```

## Processus de Review

1. **Vérification automatique** : GitHub Actions vérifie les secrets et la structure
2. **Review de code** : Un mainteneur revue le code
3. **Tests** : Vérification des tests et de la compatibilité
4. **Merge** : Fusion dans main après approbation

## Processus de Release

Les releases suivent [Semantic Versioning](https://semver.org/) :

- **MAJOR** : Changements incompatibles (v2.0.0)
- **MINOR** : Nouvelles fonctionnalités (v1.1.0)
- **PATCH** : Corrections de bugs (v1.0.1)

## Besoin d'Aide ?

- 📖 Consulter la documentation : `README.md`, `SECURITY.md`
- 🐛 Signaler un bug : Créer une issue
- 💬 Discuter : Ouvrir une discussion
- 📧 Contacter : [support@mahouto.app](mailto:support@mahouto.app)

## Licence

En contribuant, vous acceptez que vos contributions soient sous la même licence que le projet.

---

**Merci de contribuer à MAHOUTO+ !** 🚀
