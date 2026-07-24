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
