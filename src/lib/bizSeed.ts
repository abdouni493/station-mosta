/**
 * ─── Constant seed data for the business modules ───────────────────────────────
 * Rich demo data so every new interface (Restaurant / Cafétéria / Lavage /
 * Magasin) is populated out of the box. Everything is deterministic (stable ids)
 * so localStorage rehydration and cross-references stay consistent.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import {
  BizState, ModuleState, ModuleKey, BizProduct, BizNamed,
} from './bizConfig';

// Recent ISO date, `d` days ago.
const daysAgo = (d: number): string => {
  const dt = new Date();
  dt.setDate(dt.getDate() - d);
  return dt.toISOString();
};
const future = (d: number): string => {
  const dt = new Date();
  dt.setDate(dt.getDate() + d);
  return dt.toISOString().split('T')[0];
};

const emptyModule = (): ModuleState => ({
  categories: [], marques: [], roles: [], products: [], purchases: [], sales: [],
  clients: [], suppliers: [], workers: [], expenses: [], caisse: [], productions: [],
  fiches: [], comptoir: [], destructions: [], services: [], reparations: [],
});

// Small helpers to build entities compactly.
const cat = (m: string, i: number, name: string): BizNamed => ({ id: `${m}-cat-${i}`, name });
const marque = (m: string, i: number, name: string): BizNamed => ({ id: `${m}-mrq-${i}`, name });
const role = (m: string, i: number, name: string): BizNamed => ({ id: `${m}-role-${i}`, name });

function product(
  m: string, i: number, name: string, categoryName: string, marqueName: string,
  purchasePrice: number, salePrice: number, principalQty: number, currentQty: number,
  minQty: number, unit: string, catIdx: number, mrqIdx: number, hasExp = false, expDays = 0,
): BizProduct {
  return {
    id: `${m}-prod-${i}`, name,
    description: `${name} — ${categoryName}`,
    barcode: `61900${m.length}${String(i).padStart(5, '0')}`,
    categoryId: `${m}-cat-${catIdx}`, categoryName,
    marqueId: `${m}-mrq-${mrqIdx}`, marqueName,
    principalQty, currentQty, minQty, purchasePrice, salePrice, unit,
    hasExpiration: hasExp, expirationDate: hasExp ? future(expDays) : undefined,
    createdAt: daysAgo(40 - i),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// RESTAURANT
// ════════════════════════════════════════════════════════════════════════════
function seedRestaurant(): ModuleState {
  const m = 'restaurant';
  const s = emptyModule();
  s.categories = [cat(m, 0, 'Viandes'), cat(m, 1, 'Légumes'), cat(m, 2, 'Épicerie'), cat(m, 3, 'Boissons'), cat(m, 4, 'Plats préparés')];
  s.marques = [marque(m, 0, 'Local'), marque(m, 1, 'Cévital'), marque(m, 2, 'Ramy'), marque(m, 3, 'Sans marque')];
  s.roles = [role(m, 0, 'Chef cuisinier'), role(m, 1, 'Serveur'), role(m, 2, 'Caissier'), role(m, 3, 'Plongeur')];

  s.products = [
    product(m, 1, 'Viande hachée', 'Viandes', 'Local', 1200, 1600, 40, 18, 5, 'kg', 0, 0, true, 5),
    product(m, 2, 'Poulet entier', 'Viandes', 'Local', 480, 650, 60, 32, 8, 'kg', 0, 0, true, 4),
    product(m, 3, 'Pommes de terre', 'Légumes', 'Local', 60, 90, 200, 120, 20, 'kg', 1, 0),
    product(m, 4, 'Tomates', 'Légumes', 'Local', 90, 140, 80, 24, 15, 'kg', 1, 0, true, 3),
    product(m, 5, 'Huile de table', 'Épicerie', 'Cévital', 620, 780, 48, 30, 10, 'L', 2, 1),
    product(m, 6, 'Semoule', 'Épicerie', 'Sans marque', 75, 110, 100, 65, 20, 'kg', 2, 3),
    product(m, 7, 'Coca-Cola 1L', 'Boissons', 'Ramy', 90, 140, 120, 70, 24, 'unité', 3, 2),
    product(m, 8, 'Eau minérale 1.5L', 'Boissons', 'Ramy', 30, 50, 240, 150, 48, 'unité', 3, 2),
  ];

  s.clients = [
    { id: `${m}-cli-1`, name: 'Karim Benali', phone: '0550112233', address: 'Cité 20 Août, Alger', createdAt: daysAgo(30) },
    { id: `${m}-cli-2`, name: 'Société Numidia', phone: '0661445566', address: 'Zone Industrielle', createdAt: daysAgo(20) },
    { id: `${m}-cli-3`, name: 'Amine Cherif', phone: '0770998877', createdAt: daysAgo(12) },
  ];
  s.suppliers = [
    { id: `${m}-sup-1`, name: 'Boucherie El Baraka', phone: '0551223344', address: 'Marché de gros', createdAt: daysAgo(50) },
    { id: `${m}-sup-2`, name: 'Primeur Rahmani', phone: '0662334455', address: 'Marché Semmar', createdAt: daysAgo(45) },
    { id: `${m}-sup-3`, name: 'Grossiste Cévital', phone: '0555667788', address: 'Béjaïa', createdAt: daysAgo(60) },
  ];
  s.workers = [
    worker(m, 1, 'Yacine Meddour', 'Chef cuisinier', 'mois', 60000, daysAgo(400)),
    worker(m, 2, 'Sofiane Belaid', 'Serveur', 'jour', 2200, daysAgo(200)),
    worker(m, 3, 'Nadia Hamdi', 'Caissier', 'mois', 45000, daysAgo(150)),
  ];
  s.services = [];
  s.fiches = [
    fiche(m, 1, 'Couscous royal', 'Plats préparés',
      [ing(`${m}-prod-2`, 'Poulet entier', 0.4, 480, 'kg'), ing(`${m}-prod-6`, 'Semoule', 0.3, 75, 'kg'), ing(`${m}-prod-3`, 'Pommes de terre', 0.2, 60, 'kg')],
      1, 850),
    fiche(m, 2, 'Burger maison', 'Plats préparés',
      [ing(`${m}-prod-1`, 'Viande hachée', 0.15, 1200, 'kg'), ing(`${m}-prod-4`, 'Tomates', 0.05, 90, 'kg')],
      1, 450),
  ];
  s.productions = [
    production(m, 1, 'Couscous royal (Lot midi)', 'Plats préparés',
      [ing(`${m}-prod-2`, 'Poulet entier', 8, 480, 'kg'), ing(`${m}-prod-6`, 'Semoule', 6, 75, 'kg')],
      20, 850, 12, 'part', false),
    production(m, 2, 'Burger maison (Lot soir)', 'Plats préparés',
      [ing(`${m}-prod-1`, 'Viande hachée', 4.5, 1200, 'kg'), ing(`${m}-prod-4`, 'Tomates', 1.5, 90, 'kg')],
      30, 450, 20, 'part', true, 28),
  ];
  s.comptoir = [
    comptoir(m, 1, 'Couscous royal', 'Plats préparés', 8, 'part', 850, 165, `${m}-prod-1`),
    comptoir(m, 2, 'Burger maison', 'Plats préparés', 10, 'part', 450, 195, `${m}-prod-2`),
    comptoir(m, 3, 'Coca-Cola 1L', 'Boissons', 40, 'unité', 140, 90),
  ];
  s.destructions = [
    { id: `${m}-dst-1`, productName: 'Burger maison', qty: 2, unitPrice: 450, value: 900, reason: 'Invendu fin de service', date: daysAgo(2), createdBy: 'Admin', recovered: false },
  ];
  s.expenses = [
    expense(m, 1, 'Gaz de ville', 'Facture mensuelle', 8500, 6, 'Charges'),
    expense(m, 2, 'Électricité', 'Facture Sonelgaz', 14200, 10, 'Charges'),
    expense(m, 3, 'Produits d\'entretien', 'Nettoyage cuisine', 3200, 3, 'Divers'),
  ];
  seedCommerce(s, m, ['Couscous royal', 'Burger maison', 'Coca-Cola 1L', 'Eau minérale 1.5L']);
  seedCaisse(s, m);
  return s;
}

// ════════════════════════════════════════════════════════════════════════════
// CAFÉTÉRIA
// ════════════════════════════════════════════════════════════════════════════
function seedCafeteria(): ModuleState {
  const m = 'cafeteria';
  const s = emptyModule();
  s.categories = [cat(m, 0, 'Café & Thé'), cat(m, 1, 'Viennoiseries'), cat(m, 2, 'Jus & Boissons'), cat(m, 3, 'Snacks'), cat(m, 4, 'Préparations')];
  s.marques = [marque(m, 0, 'Local'), marque(m, 1, 'Nescafé'), marque(m, 2, 'Ramy'), marque(m, 3, 'Sans marque')];
  s.roles = [role(m, 0, 'Barista'), role(m, 1, 'Serveur'), role(m, 2, 'Caissier')];

  s.products = [
    product(m, 1, 'Café en grains', 'Café & Thé', 'Nescafé', 1400, 0, 30, 12, 5, 'kg', 0, 1),
    product(m, 2, 'Lait', 'Préparations', 'Local', 90, 130, 100, 55, 20, 'L', 4, 0, true, 4),
    product(m, 3, 'Sucre', 'Préparations', 'Sans marque', 110, 0, 80, 40, 15, 'kg', 4, 3),
    product(m, 4, 'Farine', 'Préparations', 'Sans marque', 65, 0, 120, 70, 25, 'kg', 4, 3),
    product(m, 5, 'Jus d\'orange 1L', 'Jus & Boissons', 'Ramy', 110, 170, 90, 48, 24, 'unité', 2, 2),
    product(m, 6, 'Croissant', 'Viennoiseries', 'Local', 25, 60, 200, 90, 40, 'unité', 1, 0, true, 2),
    product(m, 7, 'Eau minérale 0.5L', 'Jus & Boissons', 'Ramy', 20, 40, 300, 180, 60, 'unité', 2, 2),
  ];
  s.clients = [
    { id: `${m}-cli-1`, name: 'Lycée Ibn Khaldoun', phone: '0551778899', address: 'Rue principale', createdAt: daysAgo(25) },
    { id: `${m}-cli-2`, name: 'Riad Saïdi', phone: '0662001122', createdAt: daysAgo(15) },
  ];
  s.suppliers = [
    { id: `${m}-sup-1`, name: 'Torréfaction Alger', phone: '0553445566', address: 'Bab Ezzouar', createdAt: daysAgo(55) },
    { id: `${m}-sup-2`, name: 'Boulangerie Centrale', phone: '0664556677', address: 'Kouba', createdAt: daysAgo(40) },
  ];
  s.workers = [
    worker(m, 1, 'Lamia Bouzid', 'Barista', 'mois', 42000, daysAgo(300)),
    worker(m, 2, 'Walid Cheriet', 'Serveur', 'jour', 2000, daysAgo(120)),
  ];
  s.fiches = [
    fiche(m, 1, 'Café au lait', 'Café & Thé',
      [ing(`${m}-prod-1`, 'Café en grains', 0.012, 1400, 'kg'), ing(`${m}-prod-2`, 'Lait', 0.1, 90, 'L'), ing(`${m}-prod-3`, 'Sucre', 0.01, 110, 'kg')],
      1, 80),
    fiche(m, 2, 'Gâteau maison', 'Viennoiseries',
      [ing(`${m}-prod-4`, 'Farine', 0.25, 65, 'kg'), ing(`${m}-prod-3`, 'Sucre', 0.15, 110, 'kg'), ing(`${m}-prod-2`, 'Lait', 0.2, 90, 'L')],
      8, 120),
  ];
  s.productions = [
    production(m, 1, 'Café au lait (Service matin)', 'Café & Thé',
      [ing(`${m}-prod-1`, 'Café en grains', 0.6, 1400, 'kg'), ing(`${m}-prod-2`, 'Lait', 5, 90, 'L')],
      50, 80, 35, 'tasse', false),
    production(m, 2, 'Gâteau maison', 'Viennoiseries',
      [ing(`${m}-prod-4`, 'Farine', 2, 65, 'kg'), ing(`${m}-prod-3`, 'Sucre', 1.2, 110, 'kg')],
      24, 120, 16, 'part', true, 22),
  ];
  s.comptoir = [
    comptoir(m, 1, 'Café au lait', 'Café & Thé', 30, 'tasse', 80, 22),
    comptoir(m, 2, 'Gâteau maison', 'Viennoiseries', 12, 'part', 120, 41),
    comptoir(m, 3, 'Croissant', 'Viennoiseries', 45, 'unité', 60, 25, `${m}-prod-6`),
  ];
  s.destructions = [
    { id: `${m}-dst-1`, productName: 'Croissant', qty: 6, unitPrice: 60, value: 360, reason: 'Rassis', date: daysAgo(1), createdBy: 'Admin', recovered: false },
  ];
  s.expenses = [
    expense(m, 1, 'Électricité', 'Facture Sonelgaz', 6800, 8, 'Charges'),
    expense(m, 2, 'Serviettes & gobelets', 'Consommables', 2400, 4, 'Divers'),
  ];
  seedCommerce(s, m, ['Café au lait', 'Croissant', 'Jus d\'orange 1L', 'Gâteau maison']);
  seedCaisse(s, m);
  return s;
}

// ════════════════════════════════════════════════════════════════════════════
// LAVAGE & RÉPARATION
// ════════════════════════════════════════════════════════════════════════════
function seedLavage(): ModuleState {
  const m = 'lavage';
  const s = emptyModule();
  s.categories = [cat(m, 0, 'Consommables'), cat(m, 1, 'Pièces'), cat(m, 2, 'Lubrifiants')];
  s.marques = [marque(m, 0, 'Local'), marque(m, 1, 'Total'), marque(m, 2, 'Bosch'), marque(m, 3, 'Sans marque')];
  s.roles = [role(m, 0, 'Mécanicien'), role(m, 1, 'Laveur'), role(m, 2, 'Chef d\'atelier')];

  s.products = [
    product(m, 1, 'Shampoing carrosserie', 'Consommables', 'Local', 350, 0, 60, 28, 10, 'L', 0, 0),
    product(m, 2, 'Huile moteur 5W40', 'Lubrifiants', 'Total', 1800, 2400, 40, 15, 8, 'L', 2, 1),
    product(m, 3, 'Filtre à huile', 'Pièces', 'Bosch', 650, 950, 50, 22, 10, 'unité', 1, 2),
    product(m, 4, 'Filtre à air', 'Pièces', 'Bosch', 800, 1200, 35, 14, 8, 'unité', 1, 2),
    product(m, 5, 'Plaquettes de frein', 'Pièces', 'Bosch', 2200, 3200, 25, 9, 5, 'jeu', 1, 2),
    product(m, 6, 'Liquide lave-glace', 'Consommables', 'Local', 180, 300, 80, 44, 15, 'L', 0, 0),
  ];
  s.clients = [
    { id: `${m}-cli-1`, name: 'Mohamed Ziani', phone: '0550334455', address: 'Rue des Frères', createdAt: daysAgo(20) },
    { id: `${m}-cli-2`, name: 'Transport Express', phone: '0661556677', address: 'Zone Activité', createdAt: daysAgo(18) },
    { id: `${m}-cli-3`, name: 'Fatima Larbi', phone: '0770667788', createdAt: daysAgo(8) },
  ];
  s.suppliers = [
    { id: `${m}-sup-1`, name: 'Auto Pièces Center', phone: '0552667788', address: 'Rouiba', createdAt: daysAgo(60) },
    { id: `${m}-sup-2`, name: 'Distrib. Total', phone: '0663778899', address: 'Alger', createdAt: daysAgo(50) },
  ];
  s.workers = [
    worker(m, 1, 'Rachid Benmoussa', 'Mécanicien', 'mois', 55000, daysAgo(500)),
    worker(m, 2, 'Karim Ould Ali', 'Laveur', 'jour', 1800, daysAgo(100)),
  ];
  s.services = [
    { id: `${m}-srv-1`, name: 'Lavage complet', description: 'Extérieur + intérieur', price: 800 },
    { id: `${m}-srv-2`, name: 'Lavage extérieur', description: 'Carrosserie uniquement', price: 400 },
    { id: `${m}-srv-3`, name: 'Vidange moteur', description: 'Huile + filtre', price: 1500 },
    { id: `${m}-srv-4`, name: 'Changement plaquettes', description: 'Avant ou arrière', price: 2000 },
    { id: `${m}-srv-5`, name: 'Diagnostic', description: 'Contrôle électronique', price: 1000 },
  ];
  s.reparations = [
    {
      id: `${m}-rep-1`, ref: 'RDV-0001', kind: 'appointment', clientId: `${m}-cli-1`, clientName: 'Mohamed Ziani',
      car: { name: 'Clio 4', marque: 'Renault', color: 'Gris', year: '2018', immatriculation: '00123-116-16' },
      services: [{ id: `${m}-srv-3`, name: 'Vidange moteur', price: 1500 }, { id: `${m}-srv-1`, name: 'Lavage complet', price: 800 }],
      usedProducts: [{ productId: `${m}-prod-2`, productName: 'Huile moteur 5W40', qty: 4, unitPrice: 2400, total: 9600 }],
      problem: 'Entretien périodique 20 000 km', total: 2300, paid: 1000, rest: 1300, status: 'pending',
      comingDate: future(1) + 'T09:00', outDate: future(1) + 'T12:00', date: daysAgo(1), workers: [`${m}-wrk-1`], createdBy: 'Admin',
    },
    {
      id: `${m}-rep-2`, ref: 'REP-0002', kind: 'reparation', clientId: `${m}-cli-2`, clientName: 'Transport Express',
      car: { name: 'Master', marque: 'Renault', color: 'Blanc', year: '2020', immatriculation: '04521-116-16' },
      services: [{ id: `${m}-srv-4`, name: 'Changement plaquettes', price: 2000 }],
      usedProducts: [{ productId: `${m}-prod-5`, productName: 'Plaquettes de frein', qty: 1, unitPrice: 3200, total: 3200 }],
      problem: 'Freins avant usés', total: 5200, paid: 5200, rest: 0, status: 'finalized',
      date: daysAgo(3), workers: [`${m}-wrk-1`], createdBy: 'Admin',
    },
    {
      id: `${m}-rep-3`, ref: 'LAV-0003', kind: 'lavage', clientId: `${m}-cli-3`, clientName: 'Fatima Larbi',
      car: { name: 'Symbol', marque: 'Renault', color: 'Rouge', immatriculation: '01998-116-16' },
      services: [{ id: `${m}-srv-2`, name: 'Lavage extérieur', price: 400 }],
      usedProducts: [], problem: '', total: 400, paid: 400, rest: 0, status: 'finalized',
      date: daysAgo(1), workers: [`${m}-wrk-2`], createdBy: 'Admin',
    },
  ];
  s.expenses = [
    expense(m, 1, 'Eau (lavage)', 'Facture SEAAL', 9200, 7, 'Charges'),
    expense(m, 2, 'Électricité', 'Compresseur & éclairage', 7600, 9, 'Charges'),
  ];
  seedCaisse(s, m);
  return s;
}

// ════════════════════════════════════════════════════════════════════════════
// MAGASIN (retail)
// ════════════════════════════════════════════════════════════════════════════
function seedMagasin(): ModuleState {
  const m = 'magasin';
  const s = emptyModule();
  s.categories = [cat(m, 0, 'Alimentaire'), cat(m, 1, 'Hygiène'), cat(m, 2, 'Entretien'), cat(m, 3, 'Accessoires auto'), cat(m, 4, 'Boissons')];
  s.marques = [marque(m, 0, 'Cévital'), marque(m, 1, 'Ramy'), marque(m, 2, 'Henkel'), marque(m, 3, 'Sans marque')];
  s.roles = [role(m, 0, 'Vendeur'), role(m, 1, 'Caissier'), role(m, 2, 'Gérant magasin')];

  s.products = [
    product(m, 1, 'Huile Fleurial 5L', 'Alimentaire', 'Cévital', 1250, 1550, 60, 24, 12, 'unité', 0, 0),
    product(m, 2, 'Sucre 1kg', 'Alimentaire', 'Cévital', 105, 140, 200, 88, 40, 'unité', 0, 0),
    product(m, 3, 'Savon liquide', 'Hygiène', 'Henkel', 220, 320, 90, 40, 20, 'unité', 1, 2),
    product(m, 4, 'Détergent Isis', 'Entretien', 'Henkel', 380, 520, 70, 30, 15, 'unité', 2, 2),
    product(m, 5, 'Huile moteur 1L', 'Accessoires auto', 'Sans marque', 550, 780, 50, 18, 10, 'unité', 3, 3),
    product(m, 6, 'Coca-Cola 2L', 'Boissons', 'Ramy', 130, 190, 150, 72, 36, 'unité', 4, 1),
    product(m, 7, 'Eau minérale 1.5L', 'Boissons', 'Ramy', 30, 50, 300, 160, 60, 'unité', 4, 1),
    product(m, 8, 'Lingettes auto', 'Accessoires auto', 'Sans marque', 160, 260, 80, 35, 20, 'unité', 3, 3),
  ];
  s.clients = [
    { id: `${m}-cli-1`, name: 'Bilal Toumi', phone: '0551009988', address: 'Cité 500 logements', createdAt: daysAgo(22) },
    { id: `${m}-cli-2`, name: 'Épicerie Ennour', phone: '0662118877', address: 'Rue du marché', createdAt: daysAgo(16) },
    { id: `${m}-cli-3`, name: 'Samir Aouad', phone: '0770227766', createdAt: daysAgo(9) },
  ];
  s.suppliers = [
    { id: `${m}-sup-1`, name: 'Grossiste Cévital', phone: '0553220099', address: 'Béjaïa', createdAt: daysAgo(65) },
    { id: `${m}-sup-2`, name: 'Distrib. Ramy', phone: '0664331100', address: 'Blida', createdAt: daysAgo(48) },
    { id: `${m}-sup-3`, name: 'Henkel Algérie', phone: '0555442211', address: 'Alger', createdAt: daysAgo(70) },
  ];
  s.workers = [
    worker(m, 1, 'Hakim Slimani', 'Gérant magasin', 'mois', 58000, daysAgo(600)),
    worker(m, 2, 'Ines Belkacem', 'Caissier', 'mois', 40000, daysAgo(180)),
    worker(m, 3, 'Omar Fellah', 'Vendeur', 'jour', 2000, daysAgo(90)),
  ];
  s.expenses = [
    expense(m, 1, 'Loyer magasin', 'Mensuel', 35000, 5, 'Loyer'),
    expense(m, 2, 'Électricité', 'Facture Sonelgaz', 11200, 9, 'Charges'),
    expense(m, 3, 'Sacs & emballages', 'Consommables', 4200, 4, 'Divers'),
  ];
  seedCommerce(s, m, ['Huile Fleurial 5L', 'Sucre 1kg', 'Coca-Cola 2L', 'Détergent Isis', 'Eau minérale 1.5L']);
  seedCaisse(s, m);
  return s;
}

// ─── Shared builders ────────────────────────────────────────────────────────────

function worker(m: string, i: number, name: string, roleName: string, salaryType: 'jour' | 'mois', salaryAmount: number, startDate: string) {
  return {
    id: `${m}-wrk-${i}`, name, phone: `055${i}00${i}0${i}${i}`, roleName,
    paid: true, salaryType, salaryAmount, hasAccount: false, startDate,
    permissions: {}, acomptes: [
      { id: `${m}-acp-${i}`, date: daysAgo(10), amount: salaryType === 'mois' ? 10000 : 3000, description: 'Avance', paid: false },
    ], absences: [], payments: [], createdAt: startDate,
  };
}

function expense(m: string, i: number, name: string, description: string, amount: number, dAgo: number, category: string) {
  return { id: `${m}-exp-${i}`, name, description, amount, date: daysAgo(dAgo), category };
}

function ing(productId: string, productName: string, quantityUsed: number, unitCost: number, unit: string) {
  return { productId, productName, quantityUsed, unitCost, lineCost: +(quantityUsed * unitCost).toFixed(2), unit, sourceType: 'stock' as const };
}

function fiche(m: string, i: number, name: string, categoryName: string, ingredients: ReturnType<typeof ing>[], outputQuantity: number, unitPrice: number) {
  const totalCost = +ingredients.reduce((sum, x) => sum + x.lineCost, 0).toFixed(2);
  const costPerUnit = outputQuantity > 0 ? +(totalCost / outputQuantity).toFixed(2) : 0;
  const totalValue = +(outputQuantity * unitPrice).toFixed(2);
  return {
    id: `${m}-fic-${i}`, name, categoryName, categoryId: `${m}-cat-4`, ingredients,
    sellByUnit: true, sellUnit: 'part', usableInProduction: false, productUnit: 'part',
    outputQuantity, unitPrice, totalCost, costPerUnit, totalValue,
    gainsPerUnit: +(unitPrice - costPerUnit).toFixed(2), totalGains: +(totalValue - totalCost).toFixed(2),
    createdAt: daysAgo(30 - i),
  };
}

function production(
  m: string, i: number, name: string, categoryName: string, ingredients: ReturnType<typeof ing>[],
  expectedQuantity: number, unitPrice: number, sentToComptoir: number, unit: string,
  hasLoss: boolean, realQuantity = 0,
) {
  const totalCost = +ingredients.reduce((sum, x) => sum + x.lineCost, 0).toFixed(2);
  const outputQuantity = hasLoss ? realQuantity : expectedQuantity;
  const costPerUnit = outputQuantity > 0 ? +(totalCost / outputQuantity).toFixed(2) : 0;
  const lossQuantity = hasLoss ? Math.max(0, expectedQuantity - realQuantity) : 0;
  return {
    id: `${m}-prd-${i}`, name, categoryName, date: daysAgo(4 - i + 1), createdBy: 'Admin', ingredients,
    outputQuantity, expectedQuantity, sentToComptoir, unit, unitPrice, totalCost,
    totalValue: +(outputQuantity * unitPrice).toFixed(2), costPerUnit,
    hasLoss, lossQuantity, lossValue: +(lossQuantity * costPerUnit).toFixed(2),
    lossReason: hasLoss ? 'Évaporation / perte à la cuisson' : undefined,
  };
}

function comptoir(m: string, i: number, productName: string, categoryName: string, qty: number, unit: string, unitPrice: number, purchasePrice: number, sourceProductionId?: string) {
  return { id: `${m}-cmp-${i}`, productName, categoryName, qty, unit, unitPrice, purchasePrice, date: daysAgo(3), sourceProductionId };
}

// Generates a batch of sale invoices referencing the given product names.
function seedCommerce(s: ModuleState, m: string, productNames: string[]) {
  const clients = s.clients;
  for (let i = 1; i <= 6; i++) {
    const client = i % 3 === 0 ? null : clients[i % clients.length];
    const nItems = 1 + (i % 3);
    const items = [];
    for (let j = 0; j < nItems; j++) {
      const name = productNames[(i + j) % productNames.length];
      const prod = s.products.find(p => p.name === name);
      const unitPrice = prod ? prod.salePrice || prod.purchasePrice * 1.3 : 150;
      const qty = 1 + ((i + j) % 4);
      items.push({ productId: prod?.id || `${m}-x`, productName: name, qty, unitPrice, total: +(qty * unitPrice).toFixed(2) });
    }
    const subtotal = +items.reduce((sum, x) => sum + (x.total || 0), 0).toFixed(2);
    const reduction = i % 4 === 0 ? 100 : 0;
    const total = subtotal - reduction;
    const paid = i % 5 === 0 ? Math.round(total * 0.6) : total;
    s.sales.push({
      id: `${m}-sale-${i}`, ref: `V-${String(i).padStart(4, '0')}`,
      clientId: client?.id, clientName: client?.name || 'Client de passage',
      items, subtotal, reduction, total, paid, rest: +(total - paid).toFixed(2),
      date: daysAgo(i * 2), status: total - paid > 0 ? 'crédit' : 'payée', createdBy: 'Admin',
    });
  }
  // A few purchases
  const suppliers = s.suppliers;
  for (let i = 1; i <= 4; i++) {
    const supplier = suppliers[i % suppliers.length];
    const nItems = 1 + (i % 2);
    const items = [];
    for (let j = 0; j < nItems; j++) {
      const prod = s.products[(i + j) % s.products.length];
      const qty = 10 + ((i + j) % 5) * 5;
      items.push({ productId: prod.id, productName: prod.name, qty, unitPrice: prod.purchasePrice, minQty: prod.minQty, total: +(qty * prod.purchasePrice).toFixed(2) });
    }
    const total = +items.reduce((sum, x) => sum + (x.total || 0), 0).toFixed(2);
    const paid = i % 3 === 0 ? Math.round(total * 0.5) : total;
    s.purchases.push({
      id: `${m}-pur-${i}`, ref: `A-${String(i).padStart(4, '0')}`,
      supplierId: supplier.id, supplierName: supplier.name, items,
      total, paid, rest: +(total - paid).toFixed(2), date: daysAgo(i * 3 + 1), createdAt: daysAgo(i * 3 + 1), createdBy: 'Admin',
    });
  }
}

function seedCaisse(s: ModuleState, m: string) {
  s.caisse = [
    { id: `${m}-csh-1`, type: 'deposit', amount: 50000, date: daysAgo(15), description: 'Fonds de caisse initial', category: 'Apport' },
    { id: `${m}-csh-2`, type: 'withdraw', amount: 12000, date: daysAgo(7), description: 'Retrait gérant', category: 'Retrait' },
    { id: `${m}-csh-3`, type: 'deposit', amount: 20000, date: daysAgo(3), description: 'Réapprovisionnement caisse', category: 'Apport' },
  ];
}

// ─── Public factory ─────────────────────────────────────────────────────────────
export function buildSeed(): BizState {
  return {
    restaurant: seedRestaurant(),
    cafeteria: seedCafeteria(),
    lavage: seedLavage(),
    magasin: seedMagasin(),
  };
}

export const EMPTY_MODULE = emptyModule;
