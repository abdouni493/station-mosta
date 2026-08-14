/**
 * ─── Cuves — le niveau relu depuis les documents ────────────────────────────────
 *
 * `tanks.current` est un COMPTEUR : il ne bouge que par delta (achat +, brigade −)
 * via la RPC `adjust_tank_level`. C'est rapide et concurrent, mais un compteur ne
 * sait pas se relire : si une écriture est perdue — panne réseau, session fermée
 * pendant l'enregistrement, ou l'ancien bug qui réécrivait le niveau en valeur
 * absolue — le compteur s'écarte des documents et RIEN ne le ramène. C'est
 * exactement ce qui s'est produit : les cuves affichaient 0 L alors que 41 000 L
 * d'achats étaient enregistrés.
 *
 * Ce module donne le second regard qui manquait : le niveau THÉORIQUE, recalculé
 * de zéro à chaque affichage à partir des seules pièces qui font foi —
 *
 *     achats carburant  +  bons de livraison  −  litres débités par les brigades
 *
 * — pour que l'écran Cuves puisse montrer les deux et proposer de les réaligner.
 * Même principe que `lib/supplierDebt.ts` pour les dettes fournisseurs : le
 * document est la source, la colonne n'est qu'un miroir.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import type { Brigade, DeliveryNote, Pump, PumpNozzle, Purchase, Tank } from '../store/AppContext';
import { brigadeTankConsumption } from './brigadeTanks';
import { tankQuantitiesOf, type TankDelta } from './fuelPurchase';

/** Les collections dont dépend le niveau d'une cuve. */
export interface TankLedgerSource {
  purchases?: Purchase[];
  deliveryNotes?: DeliveryNote[];
  brigades?: Brigade[];
  pumpNozzles?: PumpNozzle[];
  pumps?: Pump[];
}

/** Le mouvement d'une cuve, décomposé pièce par pièce. */
export interface TankLedger {
  /** Litres livrés par les achats carburant. */
  purchased: number;
  /** Litres livrés par les anciens bons de livraison (écran remplacé). */
  delivered: number;
  /** Litres débités par les pistolets pendant les brigades. */
  consumed: number;
  /** Niveau théorique : ce que les documents disent que la cuve contient. */
  expected: number;
  /** Niveau enregistré sur la cuve (`tanks.current`). */
  stored: number;
  /** `stored − expected` : positif = la cuve annonce plus que ses documents. */
  drift: number;
}

/** Un écart inférieur à ce seuil (en litres) n'est que du bruit d'arrondi. */
export const TANK_DRIFT_TOLERANCE = 1;

/**
 * Litres apportés à chaque cuve par un bon de livraison. Un BL peut alimenter
 * plusieurs cuves via ses `items` ; les BL anciens ne portent qu'un `tankId` et
 * un volume uniques. Un BL rattaché à un achat n'est PAS compté : ses litres
 * sont déjà ceux de l'achat, les additionner doublerait la livraison.
 */
function deliveryQuantitiesOf(note: DeliveryNote): Record<string, number> {
  const byTank: Record<string, number> = {};
  const items = note.items || [];
  if (items.length > 0) {
    items.forEach(i => {
      if (!i?.tankId) return;
      byTank[i.tankId] = (byTank[i.tankId] || 0) + (Number(i.liters) || 0);
    });
    return byTank;
  }
  if (note.tankId && (Number(note.liters) || 0) > 0) byTank[note.tankId] = Number(note.liters) || 0;
  return byTank;
}

/**
 * Le mouvement de TOUTES les cuves, en un seul passage sur les documents —
 * l'écran Cuves en affiche cinq ou dix, il ne doit pas relire les achats une
 * fois par cuve.
 */
export function tankLedgers(tanks: Tank[], data: TankLedgerSource): Record<string, TankLedger> {
  const purchased: Record<string, number> = {};
  const delivered: Record<string, number> = {};
  const consumed: Record<string, number> = {};

  (data.purchases || []).forEach(p => {
    Object.entries(tankQuantitiesOf(p)).forEach(([tankId, liters]) => {
      purchased[tankId] = (purchased[tankId] || 0) + liters;
    });
  });

  // Les BL déjà facturés par un achat sont ignorés : l'achat les porte déjà.
  const billedNoteIds = new Set(
    (data.purchases || []).map(p => p.linkedDeliveryNoteId).filter(Boolean) as string[]);
  (data.deliveryNotes || []).forEach(note => {
    if (billedNoteIds.has(note.id)) return;
    Object.entries(deliveryQuantitiesOf(note)).forEach(([tankId, liters]) => {
      delivered[tankId] = (delivered[tankId] || 0) + liters;
    });
  });

  const nozzles = data.pumpNozzles || [];
  const pumps = data.pumps || [];
  (data.brigades || []).forEach(b => {
    Object.entries(brigadeTankConsumption(b, nozzles, pumps)).forEach(([tankId, liters]) => {
      consumed[tankId] = (consumed[tankId] || 0) + liters;
    });
  });

  const out: Record<string, TankLedger> = {};
  tanks.forEach(t => {
    const inPurchases = purchased[t.id] || 0;
    const inDeliveries = delivered[t.id] || 0;
    const out_ = consumed[t.id] || 0;
    // Une cuve ne descend pas sous zéro, et ne déborde pas de sa capacité : les
    // deux bornes évitent d'annoncer un théorique qui n'existe pas physiquement.
    const expected = Math.min(
      t.capacity > 0 ? t.capacity : Number.POSITIVE_INFINITY,
      Math.max(0, inPurchases + inDeliveries - out_));
    const stored = Number(t.current) || 0;
    out[t.id] = {
      purchased: inPurchases,
      delivered: inDeliveries,
      consumed: out_,
      expected,
      stored,
      drift: stored - expected,
    };
  });
  return out;
}

/** Le mouvement d'UNE cuve. */
export function tankLedger(tank: Tank, data: TankLedgerSource): TankLedger {
  return tankLedgers([tank], data)[tank.id];
}

/** Vrai si le niveau enregistré s'est écarté de ce que disent les documents. */
export function hasDrift(ledger: TankLedger | undefined): boolean {
  return !!ledger && Math.abs(ledger.drift) > TANK_DRIFT_TOLERANCE;
}

/**
 * Deltas ramenant les cuves sur leur niveau théorique. On passe par des deltas
 * (jamais par une écriture absolue) pour que le réalignement suive la même
 * route que les achats et les brigades — la RPC `adjust_tank_level` — et reste
 * juste même si une autre session écrit au même moment.
 */
export function realignTankDeltas(tanks: Tank[], data: TankLedgerSource): TankDelta[] {
  const ledgers = tankLedgers(tanks, data);
  return tanks
    .map(t => ({ tankId: t.id, deltaLiters: -(ledgers[t.id]?.drift || 0) }))
    .filter(d => Math.abs(d.deltaLiters) > TANK_DRIFT_TOLERANCE);
}
