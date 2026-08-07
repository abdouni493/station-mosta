/**
 * ─── Fusion de l'état partagé des parties (Cafétéria / Lavage) ─────────────────
 *
 *  LE PROBLÈME QUE CE FICHIER RÈGLE
 *  Les parties commerciales vivent dans UNE ligne JSON (`biz_store`). Chaque
 *  poste gardait sa copie complète en mémoire et la RÉÉCRIVAIT en entier :
 *
 *    • au démarrage, la copie du serveur ÉCRASAIT la copie locale — un produit
 *      créé puis suivi d'un rafraîchissement (avant que l'envoi différé de
 *      800 ms soit parti) disparaissait définitivement ;
 *    • deux postes ouverts en même temps s'effaçaient mutuellement : le poste B
 *      enregistrait sa copie — vieille de dix minutes — et le produit créé par
 *      le poste A n'existait plus.
 *
 *  CE QUE FAIT CE MODULE
 *  Deux états ne s'écrasent plus : ils FUSIONNENT, ligne par ligne.
 *
 *    1. Chaque écriture locale horodate la ligne touchée (`_upd`).
 *    2. La fusion réunit les deux côtés par `id` ; sur une ligne présente des
 *       deux côtés, c'est l'horodatage le plus récent qui gagne.
 *    3. Une suppression laisse une PIERRE TOMBALE (`deletedIds`) — sinon la
 *       fusion ferait revenir tout ce qui vient d'être supprimé. Une ligne
 *       modifiée APRÈS sa suppression ailleurs est conservée (la modification
 *       la plus récente fait foi).
 *
 *  Résultat : plus rien de ce qui a été créé ne peut être perdu par une simple
 *  course entre deux postes ou entre le local et le serveur.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { BizState, ModuleKey, ModuleState, BizCollection } from './bizConfig';
import { EMPTY_MODULE } from './bizSeed';

/** Champ posé sur chaque ligne écrite localement : quand elle a été touchée. */
export const STAMP = '_upd';

/** Parties réellement présentes dans l'état courant. */
export const MODULE_KEYS: ModuleKey[] = ['cafeteria', 'lavage'];

/** Collections fusionnées ligne par ligne (toutes portent un `id`). */
export const MERGE_COLLECTIONS: BizCollection[] = [
  'categories', 'marques', 'roles', 'products', 'purchases', 'sales',
  'clients', 'suppliers', 'workers', 'expenses', 'caisse', 'productions',
  'fiches', 'comptoir', 'destructions', 'reparations', 'sessions', 'payRequests',
  'inventaires',
];

/** Une pierre tombale plus vieille que ça ne sert plus à rien : on l'oublie. */
const TOMBSTONE_TTL_DAYS = 60;

/** État d'une partie augmenté des méta-données de fusion. */
export interface SyncMeta {
  /** id supprimé → date ISO de la suppression. */
  deletedIds?: Record<string, string>;
  /** Horodatage du dernier changement d'ordre des accès rapides du POS. */
  posPinnedUpd?: string;
}

export type SyncModuleState = ModuleState & SyncMeta;

export const nowIso = (): string => new Date().toISOString();

/** Pose l'horodatage d'écriture sur une ligne (copie — jamais de mutation). */
export function stampItem<T extends object>(item: T, at: string = nowIso()): T {
  return { ...(item as any), [STAMP]: at } as T;
}

/**
 * Horodatage d'ÉCRITURE d'une ligne : c'est lui qui départage deux versions.
 * `createdAt` / `date` n'en font pas partie — ils ne bougent pas quand la ligne
 * est modifiée, ils ne disent donc rien de la fraîcheur d'une version.
 */
function writeStamp(item: any): string {
  return (item && (item[STAMP] || item.updatedAt)) || '';
}

/**
 * Horodatage d'AFFICHAGE : sert uniquement à remettre la liste fusionnée dans
 * l'ordre habituel de l'application (le plus récent en tête).
 */
function sortStamp(item: any): string {
  return (item && (item[STAMP] || item.updatedAt || item.createdAt || item.date)) || '';
}

/** Des deux versions d'une même ligne, garde la plus récemment écrite (égalité → `a`). */
function pickNewer<T>(a: T, b: T): T {
  return writeStamp(b) > writeStamp(a) ? b : a;
}

/** Réunit deux registres de suppressions en gardant la date la plus récente. */
function mergeTombstones(
  a: Record<string, string> = {},
  b: Record<string, string> = {},
): Record<string, string> {
  const out: Record<string, string> = { ...a };
  for (const [id, at] of Object.entries(b)) {
    if (!out[id] || at > out[id]) out[id] = at;
  }
  return out;
}

/** Oublie les suppressions trop anciennes pour que le blob ne gonfle pas. */
function pruneTombstones(tombs: Record<string, string>): Record<string, string> {
  const limit = new Date(Date.now() - TOMBSTONE_TTL_DAYS * 86_400_000).toISOString();
  const out: Record<string, string> = {};
  for (const [id, at] of Object.entries(tombs)) if (at >= limit) out[id] = at;
  return out;
}

const asArray = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/**
 * Fusionne DEUX états d'une même partie.
 *
 * `base` est le côté qui gagne à égalité — on lui passe toujours l'état LOCAL,
 * pour qu'une ligne tout juste créée ici ne puisse jamais être effacée par une
 * copie du serveur qui ne la connaît pas encore.
 */
export function mergeModuleState(base: SyncModuleState, incoming: SyncModuleState): SyncModuleState {
  const tombs = pruneTombstones(mergeTombstones(base.deletedIds, incoming.deletedIds));
  const out: any = { ...EMPTY_MODULE(), ...base };

  for (const coll of MERGE_COLLECTIONS) {
    const map = new Map<string, any>();
    for (const item of asArray(base[coll])) if (item?.id) map.set(item.id, item);
    for (const item of asArray(incoming[coll])) {
      if (!item?.id) continue;
      const prev = map.get(item.id);
      map.set(item.id, prev ? pickNewer(prev, item) : item);
    }

    out[coll] = [...map.values()]
      // Une ligne supprimée ne revient que si elle a été modifiée APRÈS coup.
      .filter(item => {
        const killedAt = tombs[item.id];
        return !killedAt || writeStamp(item) > killedAt;
      })
      .sort((x, y) => {
        const sx = sortStamp(x), sy = sortStamp(y);
        return sx === sy ? 0 : sx > sy ? -1 : 1;   // le plus récent en tête
      });
  }

  // Ordre des accès rapides du point de vente : une simple valeur, le dernier
  // qui l'a réglée l'emporte.
  const basePin = base.posPinnedUpd || '';
  const inPin = incoming.posPinnedUpd || '';
  if (inPin > basePin) {
    out.posPinned = asArray(incoming.posPinned);
    out.posPinnedUpd = inPin;
  } else {
    out.posPinned = asArray(base.posPinned);
    if (basePin) out.posPinnedUpd = basePin;
  }

  out.deletedIds = tombs;
  return out as SyncModuleState;
}

/** Fusionne deux états complets (toutes les parties). */
export function mergeBizState(base: BizState, incoming: BizState | null | undefined): BizState {
  if (!incoming) return base;
  const out: any = {};
  for (const key of MODULE_KEYS) {
    out[key] = mergeModuleState(
      (base?.[key] || EMPTY_MODULE()) as SyncModuleState,
      (incoming?.[key] || EMPTY_MODULE()) as SyncModuleState,
    );
  }
  return out as BizState;
}

/**
 * Toutes les lignes de l'état, à plat — sert à vérifier qu'une création est
 * bien arrivée jusqu'au serveur.
 */
export function hasItem(state: BizState | null | undefined, module: ModuleKey, coll: BizCollection, id: string): boolean {
  const list = (state as any)?.[module]?.[coll];
  return Array.isArray(list) && list.some((x: any) => x?.id === id);
}
