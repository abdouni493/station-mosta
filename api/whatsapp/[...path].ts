/**
 * ─── ADAPTATEUR HÉBERGEUR ──────────────────────────────────────────────────────
 *
 * Une SEULE fonction serverless couvre `/api/whatsapp/*`. Ce fichier ne contient
 * aucune règle : il traduit la requête de l'hébergeur vers `handleWhatsApp`, qui
 * porte les routes — les mêmes que celles servies par `server.ts` en
 * développement. Voir `api/_lib/router.ts`.
 *
 * L'équivalent pour le poste de développement est dans `server.ts`.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { handleWhatsApp } from '../_lib/router.js';

export default async function handler(req: any, res: any) {
  const raw = req.query?.path;
  const path = Array.isArray(raw) ? raw.join('/') : String(raw || '');

  // Le corps arrive déjà analysé chez l'hébergeur ; on tolère la chaîne brute
  // pour ne pas dépendre de ce comportement.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const out = await handleWhatsApp({
    path,
    method: req.method || 'GET',
    body: body || {},
    headers: req.headers || {},
    host: String(req.headers?.['x-forwarded-host'] || req.headers?.host || ''),
    proto: String(req.headers?.['x-forwarded-proto'] || '') || undefined,
  });

  // Ces réponses ne se mettent jamais en cache : elles décrivent un état vivant.
  res.setHeader('Cache-Control', 'no-store');
  res.status(out.status).json(out.body);
}
