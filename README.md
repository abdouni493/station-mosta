# altech station — Naftal Station Manager v2

## 🎨 Design
- **Naftal brand**: Blue #003087 + Yellow #FFB800 throughout
- Glassmorphism cards, gradient buttons with glow shadows
- 10+ CSS animations (fadeIn, scaleIn, float, shimmer…)
- Framer Motion page transitions and staggered entries
- Persistent sidebar on desktop, animated drawer on mobile
- Each card has a blue→yellow top-stripe accent via `::before`
- Anti-FOUC body fade-in

## 🐛 CSS Fix Applied
The original bug: `dist/server.cjs` was missing, so `npm start` crashed.
Additionally `vite.config.ts` had a conflicting `middlewareMode:true` in server config.
Both fixed — CSS now loads correctly in production.

## 🚀 Run
```bash
npm install       # install dependencies
npm run build     # compile frontend + server
npm start         # → http://localhost:3000
```

## 🛠 Dev Mode
```bash
npm run dev       # hot-reload dev server
```

## 🗄 Migration à exécuter (comptes des employés des parties)

Les employés créés depuis **Restaurant / Cafétéria / Lavage & Réparation / Magasin**
peuvent maintenant avoir un compte de connexion. Cela nécessite une table et des
fonctions côté Supabase — à exécuter **une seule fois** :

1. Supabase → **SQL Editor** → *New query*
2. Coller le contenu de `supabase/migrations/module_workers_auth.sql`
3. **Run**

Ce script crée `module_workers` (employés + permissions), la fonction
`provision_module_worker_account()` (création du compte dans `auth.users`),
étend `get_my_role()` / `get_my_worker()` et crée `biz_store` (données des
4 parties partagées entre l'administrateur et les employés).

Tant que le script n'est pas exécuté, la création d'un compte affiche
« Migration manquante … » et le reste de l'application fonctionne normalement.
