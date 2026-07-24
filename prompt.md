Vous êtes un architecte frontend expert React, TypeScript, TailwindCSS et UI/UX Design. 
i want to add this new interfaces on the side bare : 
new part for restaurent
new part for cafeteria
new part for lavage and repair 

make for each part this interfaces : 
restaurent side bare interfaces : 
gestion de stock 
purchase 
production 
comptoire
pos 
sales
clients 
suppliers
restaurent workers
expenses
caisse restaurent
reports resetauent 

part two for the cafeteria : 
gestion de stock 
purchase 
production 
comptoire
pos 
sales
clients 
suppliers
restaurent workers
expenses
caisse cafeteria
reports cafeteria

part three for lavage and repaire : 
reparations and lavage 
services
gestion de stock
purchase
clients
suppliers
workers of repaire and alvage
expenses 
caisse lavage repair
reports lavage repaire 

program the interfaces like this with make sure to use the same colours and design of the curent colours and design of the application  : 
new interfaces of : gestion de stocka and purchase and production and comptoire and pos and sales and clients and suppliers and workers and expenses and caisse and reports  make them use the same this prompts :

Gestion de stock: 
Let user can create new products with informations : 
Product name 
Description 
Bare code : make option of generate bare code and print it if product do not have bare code
Marque (let user select marque): make next to it button for create new marque
Category ( let user select category) : make next to it button for create new category 

Let on the main page display all the products with filtering with marques and with categories and searching option with product name or bare code 
Display the products on cards with possibility of table view and make it display informations about that product how much principal quantity and how much rest and expiration date id user activate it and informations générale about the product date and make for each product button actions : 
View : for see all details informations of product
Edit : can edit all informations of product 
Delete : with confirmation 

Purchase interface : 
Let user can create new purchases like this : 
Let user search about existing products with name or bare code and let button for create new product if not existing and let it select it automatically if user create it on  the same interface of create new purchase and make sure to make the interface of create new products on the same interface of create purchases exactly the same interface of create new products on gestion de stock 
If product exists let user search for it with name or bare code with autofill and let user select it when user select product or create new product and select it automatically
Let user set this informations about it : 
Purchase Quantity 
Quality minimal for alert
Purchase price
Make option user can activate it for expiration date user can activate it and set the expiration date and can let it inactive 
Make option of user can add multiple products on the same purchase 
Then let user select supplier with possibility of create new supplier on the same interface of create new purchase: let user can create it with name and phone number and address 
Then let user set the informations of payment 
Let it display how much total of this purchase 
And how much he will pay make it by default the total price of purchase and let user can edit it and let it calculate rest automatically then let user create it when user create the purchase with that selected products make it update the informations of them automatically with edit the minimal quantity and add the quantities of purchase to the principal quantity of that product and add it also to the curent quantity and make it update the expiration date also and the purchase price 

Make the main page display the purchase invoices on cards with possibility of display on table and display them with button actions of view to see all details of purchase 
Edit to edit all details of purchase 
Pay debt for the purchases that contains rest to pay make it like this : 
let it display how much the user pay and how much rest and let it user can set how much will pay for this time with calculate the rest automatically and let him save the payement 
Delete button actions of view with confirmation 
Print make it with informations of store and contains all informations of the purchase and informations of supplier and places for signature and make the design professional

Pos interface : 
Let it display all the products from the comptoir with possibility of search about the products from name or description and let user can add multiple products on the same selling invoice then on the right side let user can create new client with name and phone number or search about existing clients and make possibility of user can do not make the client and save the selling as client passage 
Then make on the right side display the selected products with option of add and minus quantities or retrier and make it display the total price to pay and make option user can activate or not activate reduction with type how much amount of reduction that will minus from the total 
Then make user type how much client pay for this purchase make it by default is the total after reduction or without reduction make it real numbers and let user edit it and let it calculate the rest if the invoice contains rest do not let him create the invoice selling without select the client then let user create the invoice with payed or debt 

Sales interface : 
Let it display all the selling invoices in cards with possibility of table view and filtering by searching about client with name or phone number and filtering by this date and last week and last month and filtering by period with set starting date and ending date
And display them with button actions of edit and delete and view details to see all details of this invoice and button action for pay debt if there is rest to pay for this invoice let it display how much the client pay and how much rest and let it user can set how much will pay for this time with calculate the rest automatically and let him save the payement

Clients interface: 
Let user can create new client on it with name and phone number 
Let it display all  clients on cards with informations of the clients  and with button actions of :  
Edit and delete 
History : make it display all history of purchases of this client all the details informations and total pays and total purchases and total rests

Suppliers interface:
Let it display all suppliers on cards with informations of the supplier and with button actions of : 
Edit and delete 
Purchases : make it display all the purchase history with details of payements and everything detailed informations of the purchase 
And make ur display cards of total purchases total payes and total rests 
And make on the same interface possibility of create new supplier : 
make user set this informations about the supplier : 
Name 
Phone number 
Adresse 

Workers : 
Let it display all workers on cards with informations of the worker and with button actions of : 
View : for see all the informations of the worker
Edit and delete 

Permissions: make it display all interfaces of the application on the side bare let the user select what that worker can see on his side bare and make it when user select some interface then display all the button actions of that interface and let user can select what that worker can see button actions for that selected interfaces

Acompte  : let user can make acompte with dates and description and amount 

Absence:let user can make absence with date and and description and costs 

Payement: make it display all the months that not payes or the days that not payed and acomptes that not decreased from the payement and the same for the absences then make it calculate how much will pay for him with possibility of edit it manually 
And make it can edit the date of payement and make it do descriptions optional

Make on the main page a button for create new workers let it like this : 
Let user set his informations: 
Full name 
Birthday 
Id card number optional
Phone number 
Role : let him select and let button for create new role with name of role
Payement informations make it can can activate or not activate that worker will get pay or not if he activate it then let him choose if with days or months and let him set the amount 
Then let him
Activate or nor activate the account for login with his account 
If he activate it then let user set the email and user name and password 
Make the worker created with his role without any permissions then let user make his permissions from the button action of permissions  and let user set the date of starting working for this worker

Expenses : 

For the expenses of store make it user can create new expenses with name and description and amount and date 
Display the history of showroom expenses on cards with  button action of edit and delete 


 caisse :
Let user can create new transactions of deposit and withdraw money with amount and date and description and let this transactions save and user can see the history of all transactions 
Make this interface display all the sold payements of all students on liste with all details with filtering by default of this day and last week and last month and filtering by period let user set starting date and ending date make sure to make it also display the expenses if existing on this period and make it display for him how much contains on the caisse 

Reports : 
Let user set starting date and ending date and let him click on generate to see the report of that period:
Analyse this interfaces a deep analyse and make this interface display all details and informations of each interface and on it all existing filtering option of all the interfaces and make it display all purchases and all sales and all expenses of store
And make it display debts of clients and debts foe suppliers and how much rest for each one  and make it display more details about each interface  and make it display the payments for workers and make it calculate with details the expenses of all store and how much all selles and calculate the gains
Make it display also the sales of store that comes from clients

Reparation and lavage  interface: 
Make on the main page of the interaface two buttons one for create reparations and one for create lavege and onether one for appointments: 
Let user can create new appointments with this steps : 
Step1:
Let user set coming date and hour
And To go out date and hour
Step2:client
Let user select client with searching about it with name or phone nimber with possibility of create new client on the same interface with full name and phone number and make it when user create it on the same interface of create new appointments the. Let it select  that client automatically 
Step3:
Make it for the user can send the information of the car of the client name and marque and color and the year and immatriculation 
And description, make sure to make all this information optional for the user

Step4:
User on this interface, the services of this appointment with possibility of create a new service with the name, description and price on the same interface of creation of this appointment and that user can select multiple services on the same creation and make sure to make possibility of the user can type a description about the problem of the car
And make sure to make possibility of user can see about a product on the storage and use it on this appointment

Step5:
Make it display resume about all informations of appointments 
Make it display informations of the client and car and selected services with calculate total price with possibility of edit the total price manually 
Then let user set how much client pay 
Make it by default as client pay all the total with possibility of edit it and make it calculate the rest automatically 
Then let him save the appointment let the appointment save with pending statue 

The second button for creation reparation or lavage that user select directly the client or create a new one and can send the information of the car turn on the next step that user set description about the problem of the car and let user can search about a product from the storage or use it for the repair and make sure if the user create the Repair then minus that quantity of use it product from storage minus it from the storage and the same for the appointments creation and let him see the services of the repair then let him go to the last step for the creation that you display information about the repair with information of the car and client and the problem of the car and we selected services and that the user can set amount that client pay make it by default. Client pay on total with possibility of edit it and let him created as finalized statue

Display all appointment and reparations on the main page with option of search about the client with the name or phone number and options for filtering by the statue of the appointment if it’s pending or canceled or finalized 
Make the cards of appointments displayed with information of the client with services and information about the payment and how much rest to pay
Make a button action for View, the details about that appointment make sure to make it display all the information about it
Make another button action for edit and delete
Another button action for pay debt we make it display the total of the appointment we display the services and make it display how much the client did they pay and how much rest and let the user type how much we pay this time and make it calculate the rest automatically and let him save the payment
Create another button action for finalize make it on the display for the appointments with the statue of pending appointment make it display the selected services for appointment with possibility of create new services on the same interface of finalize
And make it display total price and make it display how much the client did pay and let the user can make another payment with make it calculate the rest automatically and lend the user save the finalization with convert the statue of the appointment to finalized 
Make another options of the same face of appointments, make it for filtering by this day and last week and last month and possibility of filtering by period 
Make sure to make option on the button action 
Of finalization of appointment user can search about a product from the storage for use it for the finalization of this appointment and when is the final appointment that quantity uses for this appointment finalization mine is from the storage
Make a new option on the finalization of appointments and creation of repairs make it user cancel it. The worker that made this work optionally we make sure to save this information of the appointment and Repair that assigned for that worker save them on the payment of that worker with percentage method payment make possibility of sign multiple workers on the same finalization of appointment or creation of repair and make it by default, assign it for that logged in user

Services interface:
That the user can create on it services with name and description and the price and display all the services on this interface with button an action for edit and delete


comptoire interface : 
make it display the products that comes from the products with button action of detruction and make option for see the detrictions and make user can recover sustructions or delete them from the history 

Votre mission est de générer intégralement la suite d'interfaces d'application de gestion industrielle et commerciale pour l'industrie chimique / de production ("Produits Chimiques"), en respectant l'architecture logicielle, la gestion d'état Zustand, l'i18n (Français / Arabe RTL/LTR), ainsi que les règles métier exactes décrites ci-dessous.

---

## 📐 DESIGN SYSTEM & COMPOSANTS GLOBAUX

### 1. Principes de Design & Typographie
- **Cartes & Conteneurs (Cards)** : `bg-white/80 backdrop-blur-md border shadow-card transition-all rounded-2xl`
- **Typographie** : Inter / Outfit / Sans-serif moderne, nombres tabulaires (`tabular` ou `font-mono`) pour les alignements de prix.
- **Support RTL / LTR** : Attribut `dir="rtl"` ou `dir="ltr"` dynamique selon la langue (`ar` ou `fr`).

### 2. Composants UI Réutilisables
- `PageHeader` : Titre avec icône Lucide 24px, sous-titre dynamique, et zone d'actions alignée à droite (`Button`).
- `Card` : Carte conteneur avec variante animée `framer-motion` (`variants={cardVariants}`).
- `Badge` : Pillule de statut (`info`, `warning`, `danger`, `success`).
- `Modal` : Dialogue superposé responsive avec en-tête, fermeture esc/bouton, tailles (`sm`, `md`, `lg`, `xl`).
- `ConfirmDialog` : Modal de confirmation d'action critique (suppression/récupération).
- `SearchBar` & `Select` & `Input` & `Textarea` & `Switch` / `Checkbox` & `UnitSelect`.
- `StatCard` & `EmptyState` & `Toast` (`toast.success()`, `toast.error()`).

---

## 🧪 INTERFACE 1 : PRODUCTION (GESTION DES BATCHES DE FABRICATION)

### 📂 Fichier : `src/pages/Production/index.tsx`
### 🎯 Rôle Métier
Gérer le lancement des fabrications de produits chimiques, la déduction automatique des stocks d'ingrédients bruts (ou semi-finis), la détection du stock insuffisant, la déclaration des pertes de production (évaporation, casse, non conformité), le calcul des coûts de revient, et le transfert vers le comptoir de vente.

### 📑 Structure & Composants UI
1. **Header de Page** :
   - Titre : `Production` avec icône `FlaskConical`.
   - Action : Bouton principal `+ Nouvelle Production` (Onglet Production) ou `+ Nouvelle Fiche Technique` (Onglet Formules).
2. **Barre de Navigation par Onglets (Tabs)** :
   - Tab 1 : `Productions` (`<FlaskConical size={16} />`)
   - Tab 2 : `Fiches Techniques (Formules)` (`<FileText size={16} />`)
3. **Barre de Filtrage & Recherche** :
   - Champ `SearchBar` (recherche par nom de produit).
   - Select Filtre Date (`Toutes`, `Aujourd'hui`, `Cette semaine`, `Ce mois`).
4. **Grille des Cartes de Production (`filteredProductions`)** :
   - **En-tête Carte** : Nom de la production, Badge Catégorie, Badge Alerte Perte si `hasLoss === true` (avec `<AlertTriangle />`).
   - **Sous-titre** : Date & heure de fabrication (`Clock`), Créateur (`User`).
   - **Encadré Calculs Récapitulatifs** :
     - Ingrédients consommés (nombre d'articles).
     - Quantité produite (`outputQuantity` + unité de détail si activée).
     - Si perte : Quantité prévue (`expectedQuantity`), Quantité perdue (`lossQuantity`) et Valeur financière de la perte (`lossValue`).
     - Reste en stock production : `outputQuantity - sentToComptoir`.
     - Coût total de production (`totalCost` en DA).
     - Valeur estimée à la vente (`totalValue` en DA).
     - **Gains Nets Estimés** : `totalValue - totalCost` (Différencié selon que le gain est `>= 0` ou `< 0`).
   - **Bouton d'Action Rapide** : `Mettre au comptoir (reste)` (si `outputQuantity - sentToComptoir > 0`).
   - **Pied de Carte** : Bouton `Détails` (`<Eye />`) et Bouton `Supprimer` (`<Trash2 />`).

### ➕ Workflow Modal : "Lancer une Production" (`CreateProductionForm`)
- **Étape 1 : Sélection de la Formule de Base (Fiche Technique)**
  - Champ de recherche autocomplété pour trouver une Fiche Technique enregistrée.
- **Étape 2 : Recalcul d'Échelle Proportionnel (Scale Ratio)**
  - Champ numérique : `Modifier la Quantité à Produire`.
  - Calcul dynamique du ratio d'échelle : `ratio = productionQuantity / selectedFt.outputQuantity`.
  - Recalcul instantané du dosage de chaque ingrédient (`scaledQty = ingredient.quantityUsed * ratio`).
- **Étape 3 : Vérification du Stock en Temps Réel**
  - Comparaison avec `currentQuantity` dans `stockStore`.
  - Si stock requis > stock disponible : affichage d'une bannière animée **"Stock Insuffisant !"** avec mise en évidence de la ligne d'ingrédient et **désactivation du bouton de validation**.
  - Prise en compte des ingrédients semi-finis (`sourceType === 'fiche'`) qui ne bloquent pas le stock de matière première brute.
- **Étape 4 : Gestion des Pertes (Perte de Production / Evaporation / Réduction de Rendement)**
  - Interrupteur `Switch` : `Déclarer une perte de production`.
  - Saisie de la `Quantité réellement produite` (`realQuantity`).
  - Calcul automatique : `lossQuantity = expectedQuantity - realQuantity`, `lossValue = lossQuantity * costPerUnit`.
  - Zone de texte `Description de la perte` (Ex: évaporation lors de la cuisson, résidus cuve, casse flacon).
- **Étape 5 : Validation & Impact Stock**
  - Sur confirmation : Déduction automatique des quantités d'ingrédients dans le stock brut (`stockStore.deductStock`).
  - Enregistrement de la production dans `productionStore` avec statut "disponible en stock production" en attente de transfert au comptoir.

### 📦 Workflow Modal : "Mettre au Comptoir" (`TransferToComptoirModal`)
- Affiche le produit, la quantité produite totale, la quantité déjà envoyée au comptoir, et le reste en stock de production.
- Champ de saisie de la quantité à transférer (avec bouton `Max`).
- Validation : augmente le stock de vente du comptoir (`comptoirStore.addFromProduction`) et met à jour `sentToComptoir` dans la production.

---

## 📄 INTERFACE 2 : FICHE TECHNIQUE / FORMULES (`FicheTechnicForm`)

### 📂 Modèle de Données : `FicheTechnic` (`src/store/ficheTechnicStore.ts`)
```typescript
export interface FicheTechnic {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  description?: string;
  usedProducts: UsedProduct[];
  sellByUnit?: boolean;
  sellUnit?: string;
  usableInProduction?: boolean; // Permet de la réutiliser comme composant semi-fini
  productUnit?: string;
  outputQuantity: number; // Rendement de base
  unitPrice: number;     // Prix de vente par unité
  totalCost: number;     // Coût total des ingrédients
  costPerUnit: number;   // Coût de revient unitaire
  totalValue: number;    // Valeur brute vente
  gainsPerUnit: number;  // Gain net par unité
  totalGains: number;    // Gain net total
  createdAt: string;
}
```

### 🎯 Rôle Métier
Créer le modèle/la recette théorique de fabrication chimique. Permet d'associer des matières premières brutes (du stock) ET/OU des produits semi-finis (d'autres Fiches Techniques réutilisables) pour fabriquer un produit fini.

### 📑 Formulaire de Création / Édition (`FicheTechnicForm`)
1. **Panneau Gauche : Informations Générales**
   - Champ `Nom du Produit *`.
   - Sélecteur de Catégorie de Formule avec mini-modal création/suppression de catégorie inline.
   - Textarea `Description / Procédé de fabrication`.
2. **Panneau Droit : Rendement & Tarification**
   - Interrupteur `Vendre avec unité de détail` + `UnitSelect` (Ex: Litre, Kg, Flacon 500ml, Bidon 5L).
   - Interrupteur `Utilisable comme ingrédient dans une autre production` + `UnitSelect` de produit. *(Ex: Solution Acide préparée réutilisée dans la formule d'un nettoyant complexe)*.
   - Champ `Rendement (Quantité de base produite)`.
   - Champ `Prix de vente unitaire (DA)`.
   - **Bloc de Calculs Financiers en Temps Réel** :
     - Coût des ingrédients total (`totalCost`).
     - Coût de revient unitaire (`costPerUnit = totalCost / outputQuantity`).
     - Valeur de vente totale (`totalValue = outputQuantity * unitPrice`).
     - Gain net unitaire (`gainsPerUnit = unitPrice - costPerUnit`).
     - **Gain net total de la formule** (`totalGains = totalValue - totalCost`).
3. **Section Ingrédients & Dosages**
   - Barre de recherche hybride recherchant à la fois dans :
     a. Les produits en stock brut (`Products`).
     b. Les Fiches Techniques réutilisables (`reusableFiches`) marquées comme `usableInProduction`.
   - **Liste des Ingrédients Ajoutés** :
     - Badge "Production" distinctif si l'ingrédient provient d'une formule semi-finie.
     - Affichage du prix d'achat ou du coût de revient unitaire.
     - Input de la quantité dosée avec unité.
     - Calcul automatique du coût de ligne (`quantityUsed * unitCost`).
     - Bouton suppression d'ingrédient (`<X />`).

---

## 🏪 INTERFACE 3 : COMPTOIR DE VENTE (`src/pages/Comptoir/index.tsx`)

### 🎯 Rôle Métier
Gérer le stock des produits finis prêts à la vente directe (transférés depuis la production), visualiser les valeurs en comptoir, et enregistrer l'historique des destructions/invendus/perte sur comptoir avec possibilité de récupération.

### 📑 Structure & Composants UI
1. **Header de Page** :
   - Titre : `Comptoir` avec icône `Beaker`.
   - Action : Bouton vers Statistiques Comptoir (`/caisse/statistics`).
2. **Barre de Navigation par Onglets (Tabs)** :
   - Onglet 1 : `Disponible` (Stock actif au comptoir)
   - Onglet 2 : `Historique des Destructions` (Produits jetés ou gâtés)
3. **Onglet 1 : Produits Disponibles**
   - Filtres : Barre de recherche + Filtre par Catégorie de Production.
   - **Grille des Cartes Produits (`Card`)** :
     - Nom du produit, badge catégorie.
     - Date de transfert/production.
     - Quantité disponible avec son unité.
     - Prix unitaire & Valeur totale du stock comptoir.
     - Bouton d'action : `<Flame /> Destruction` (ouvre le modal de destruction).
4. **Onglet 2 : Historique des Destructions**
   - Bannière KPI : **Total Valeur Détruite**.
   - Barre d'actions groupées (Bulk actions si éléments sélectionnés) : Bouton `Récupérer` (`<RotateCcw />`) et Bouton `Supprimer` (`<Trash2 />`).
   - Tableau complet des destructions :
     - Checkbox sélection, Date, Nom produit, Quantité détruite, Valeur perdue, Motif de destruction, Agent créateur, Actions individuelles (`Récupérer`, `Supprimer`).

### 🔥 Modal de Destruction (`Modal`)
- Affiche le nom du produit et la quantité max disponible.
- Input numérique : Quantité à détruire.
- Input texte : Motif de destruction (Ex: Peremption, Flacon fêlé, Échantillon offert, Renversé).
- Calcul dynamique en direct de la valeur détruite (`destroyQty * unitPrice`).
- Confirmation : retire la quantité du stock comptoir et enregistre la ligne dans `destructions`.

---

## 💰 INTERFACE 4 : CAISSE & MOUVEMENTS (`src/pages/Caisse/index.tsx`)

### 🎯 Rôle Métier
Superviser le solde de caisse en temps réel, la trésorerie globale de l'entreprise, les flux d'entrées/sorties de fonds, la ventilation par catégorie de dépenses et dépôts, et l'historique détaillé des opérations de caisse.

### 📑 Structure & Composants UI

#### 1. Hero Banners Trésorerie & Solde (2 Cartes Geantes)
- **Carte 1 : Solde de Caisse Actuel**
  - Icône `Wallet`, libellé "Solde de Caisse".
  - Chiffre géant animé avec hook `useCountUp` (`formatCurrency(balance)`).
  - Deux sous-cartes translucides :
    - `Encaissements Totaux` (Ventes payées + Dépôts).
    - `Décaissements Totaux` (Achats payés + Dépôts/Retraits + Charges + Salaires).
- **Carte 2 : Trésorerie Globale Entreprise**
  - Icône `PiggyBank`, libellé "Trésorerie Globale".
  - Calcul : **`Trésorerie = Solde Caisse + Valeur Stock Comptoir + Valeur Stock Matière Première`**.
  - Ventilation en 3 lignes avec icônes : Solde Caisse, Valeur Comptoir, Valeur Stock Brut.

#### 2. Sélecteur de Période Temporelle (`Period`)
- Boutons puces animés : `Aujourd'hui`, `Cette semaine`, `Ce mois`, `Cette année`, `Tout`, `Période personnalisée` (ouvre deux inputs date `Du` / `Au`).

#### 3. Cartes de Flux de la Période (`FlowCard`)
- **Entrées d'argent** (`+ DA`).
- **Sorties d'argent** (`- DA`).
- **Flux Net de la période** (`Entrées - Sorties` avec indicateur d'état).

#### 4. Ventilation des Dépôts & Retraits par Catégorie (`CategoryTotalsCard`)
- 2 Cartes côte à côte :
  - Dépôts par Catégorie (Barres de progression des entrées).
  - Retraits par Catégorie (Barres de progression des sorties).
  - Filtre interactif au clic sur une catégorie pour filtrer l'historique des transactions.

#### 5. Grille des 8 Cartes Statistiques Métier (`StatCard`)
- Ventes Totales, Achats Totaux, Charges / Dépenses, Salaires Employés, Valeur Productions, Nombre Produits Comptoir, Valeur Stock Comptoir, Valeur Stock Matière Première.

#### 6. Tableaux Comparatifs : Ventes Produits vs Reste Comptoir
- Tableau 1 : Top Ventes Produits de la période (Nom, Quantité vendue, Chiffre d'affaires).
- Tableau 2 : Reste Actuel au Comptoir (Nom, Quantité disponible, Valeur financière).

#### 7. Accordéons Détaillés Ingrédients & Achats
- **Accordéon 1 : Ingrédients Consommés par Production**
  - Liste repliable par batch de production. Sous-tableau avec : Ingrédient, Quantité utilisée, P.U Achat, Coût total ligne.
- **Accordéon 2 : Achats Groupés par Catégorie de Matière Première**
  - Liste repliable par catégorie de stock. Sous-tableau avec : Produit, Quantité achetée, Prix Unitaire Moyen, Total Achat.

#### 8. Historique des Transactions de Caisse
- Liste animée des dépôts/retraits manuels avec date, heure, créateur, catégorie, montant, boutons édition/suppression.

#### 💵 Modal Dépôt / Retrait (`Modal`)
- Switch Toggle : `Dépôt (Entrée)` vs `Retrait (Sortie)`.
- Input Montant, Input Date, Select Catégorie avec composant `CategorySelect` (création/suppression inline), Textarea Description.

---

## 📊 INTERFACE 5 : RAPPORTS DE CAISSE ET CLÔTURE (`src/pages/Caisse/CaisseReports.tsx`)

### 🎯 Rôle Métier
Permettre aux gérants/caissiers de réaliser les clôtures de caisse (journalières ou par période), de saisir le comptage physique des espèces (`declaredAmount`), d'analyser le décalage/l'écart de caisse (Surplus ou Déficit par rapport au solde théorique), et d'imprimer un rapport complet et infalsifiable.

### 📑 Structure & Composants UI

#### 1. Vue Liste des Rapports de Caisse
- Barre de filtres par date (`Tout`, `Aujourd'hui`, `Semaine`, `Mois`, `Personnalisé`).
- Bouton `+ Nouveau Rapport de Caisse`.
- **Grille des Cartes Rapports (`CaisseReport Card`)** :
  - Badge type : `Rapport Journalier` (`Calendar`) ou `Rapport de Période` (`CalendarRange`).
  - Date & Heure du rapport, Auteur créateur.
  - Montant Déclaré (Comptage espèces) vs Montant Théorique calculé par le système.
  - **Badge de Réconciliation** :
    - `Caisse Juste` (Aucun décalage, écart < 0.01 DA).
    - `Surplus : + X DA` (Si déclaré > théorique).
    - `Déficit : - X DA` (Si déclaré < théorique).
  - Boutons d'actions : `Détails` (`<Eye />`), `Imprimer` (`<Printer />`), `Éditer`, `Supprimer`.

#### 🕒 Modal de Création / Clôture de Caisse (`CaisseReport Form`)
- Toggle Type de Rapport : `Rapport Journalier` vs `Rapport de Période`.
- **Horloge Digitale Live (`LiveClock`)** : Affiche la date et l'heure courante à la seconde près.
- Inputs Date & Heure (ou Date Début / Date Fin si Période).
- Input Numérique Obligatoire : **`Montant compté en caisse (Espèces physiques en DA) *`**.
- Textarea Description (Ex: Clôture de fin de journée par Amine).

#### 📜 Vue Détail du Rapport (`ReportDetail`)
Vue ultra-complète et détaillée affichant l'intégralité du bilan financier et opérationnel couvert par le rapport :
1. **Barre d'Actions** : Bouton `Imprimer le Rapport PDF`, Bouton `Mouvements de Caisse`, Bouton `Retour`.
2. **En-tête & Cartes KPI Principales** (7 Tuiles : Ventes, Achats, Production, Dépenses, Salaires, Destructions, Pertes Production).
3. **Tableaux Détaillés par Section (16 Sections)** :
   - **Section 1 : Synthèse Financière Générale** (Ventes brutes, ventes encaissées, achats, valeur production, coût production, gains nets production, valeur pertes, dépenses, salaires, destructions, dépôts, retraits, gain net global).
   - **Section 2 : État Général du Stock** (Produits, catégories, quantité en stock, seuil min, prix d'achat, valorisation du stock).
   - **Section 3 : Achats Détaillés par Catégorie** (Groupés par Catégorie -> Produit -> Lignes de facture avec ref, fournisseur, date, quantité, prix unitaire, total).
   - **Section 4 : Productions Détaillées par Catégorie** (Groupées par Catégorie -> Batches -> Ingrédients consommés, rendement théorique, coût, chiffre d'affaires, gain).
   - **Section 4b : Productions avec Perte / Evaporation** (Détail des pertes : quantité prévue vs réelle, quantité perdue, valeur financière perdue, motif/description).
   - **Section 5 : Ventes par Catégorie** (Nom produit, quantité vendue avec unité, chiffre d'affaires généré).
   - **Section 6 : Détail Facture par Facture** (Réf, client, date, total, montant payé, reste dû).
   - **Section 7 : Dépenses / Charges par Catégorie**.
   - **Section 8 & 9 : Dettes Clients et Dettes Fournisseurs**.
   - **Section 10 : Paiements des Employés** (Salaires et Acomptes).
   - **Section 11 & 12 : Dépôts et Retraits de Caisse par Catégorie**.
   - **Section 13 : Historique des Destructions**.
   - **Section 14 : Reste du Stock au Comptoir par Catégorie**.
   - **Section 15 : Calcul du Gain Net Économique**.
   - **Section 16 : Réconciliation et Écart de Caisse** (Montant Déclaré vs Solde Théorique de Caisse vs Décalage).

### 🖨️ Moteur d'Impression PDF (`lib/reportPrint.ts`)
Toutes les fonctions d'impression génèrent un document HTML/CSS imprimable professionnel avec en-tête d'entreprise, logo, date d'impression, tableaux stylisés, numérotation de page, et mise en page optimisée pour l'impression A4/Thermal.

---

## 🧮 LOGIQUE DE CALCUL ET FORMULES METIER EXACTES

### 1. Formule de Coût de Revenir & Gains de Production
```typescript
// Coût total des ingrédients d'une production
const totalCost = usedProducts.reduce((sum, u) => sum + (u.lineCost ?? (u.quantityUsed * (u.unitCost ?? 0))), 0);

// Coût de revient unitaire
const costPerUnit = outputQuantity > 0 ? totalCost / outputQuantity : 0;

// Chiffre d'affaires estimé / Valeur totale à la vente
const totalValue = outputQuantity * unitPrice;

// Gains nets de la batch de production
const totalGains = totalValue - totalCost;
```

### 2. Formule de Perte de Production (Evaporation / Cassage)
```typescript
// Quantité perdue
const lossQuantity = hasLoss ? Math.max(0, expectedQuantity - realQuantity) : 0;

// Valeur financière perdue (valeur de la matière première gâchée)
const lossValue = lossQuantity * costPerUnit;

// Quantité finale réelle enregistrée en stock
const finalOutputQuantity = hasLoss ? realQuantity : expectedQuantity;
```

### 3. Formule de Solde Théorique de Caisse (`theoretical`)
```typescript
// Le solde théorique récapitule l'intégralité du flux de trésorerie réel (cash flow en espèces) jusqu'à la date du rapport :
const theoretical = cumDeposits + cumSalesPaid - cumWithdrawals - cumPurchasesPaid - cumExpenses - cumWorkerPayments;

// Écart / Décalage de caisse :
const decalage = declaredAmount - theoretical;
// Si decalage === 0 : Caisse parfaite
// Si decalage > 0   : Surplus de caisse (espèces en trop)
// Si decalage < 0   : Déficit de caisse (manque d'espèces)
```

### 4. Formule de Gain Net Économique Globale (`gains`)
```typescript
const netGains = totalSalesGross - totalPurchases - totalWorkerPayments - totalExpenses - totalDestroyedValue;
```

---

## 📋 DIRECTIVES DE GENERATION DE CODE POUR CLAUDE

Lorsque vous générez ces interfaces, vous devez vous assurer de :
1. Importer et utiliser les stores Zustand appropriés (`useProductionStore`, `useFicheTechnicStore`, `useComptoirStore`, `useCaisseStore`, `useCaisseReportStore`, `useStockStore`, `useSalesStore`, `usePurchaseStore`, `useExpenseStore`, `useWorkerStore`).
2. Utiliser les hooks de langue (`useLanguage`) et de permissions (`usePermissions`).
3. Gérer les états de recherche, de filtres par date, de sélection multiple, et les fenêtres modales avec un état React propre (`useState`, `useMemo`).
4. Appliquer des coins arrondis `rounded-2xl`, des ombres douces et une mise en page fluide.
5. Formater tous les montants monétaires avec `formatCurrency(val)` (affichant `DA` ou `د.ج`), et toutes les dates avec `formatDate(date, language)`.


reorganize the side bare make the workers of carburant and the interface of fiche journalier and expenses of carburant and clients and suppliers of carburant and cuves and pomps and pistes and purchase carburant and brigades and make the reports interface special for the carburant all of them on the part of carburatn 
an dmke the interfaces of magazin on the part of magasign : 
create new clients interface for it and new interface of suppliers and expenses special for the magasin and make the itnefaces of products and purchase magesine and pos magasin and create new interface of caisse for magasing and create new interface of repports for magasin 
and make on this part of magasin also the workers ofmagasin

create new interface on the side bare make for the generale reports make sure can set starting date and ending date then its will display for him all the small detail about all the parts of carburant and restaurent adn cafeteria and lavage and magasin with all small details of purchasses and sellings and products and caisse of each part and the benifits and allt he debts and the allll small details about all the interfaces of application andmake sure ot make the design of this interface exactly like the interface of settings and make it organized better and better 

make for all this new interfaces insert on them constant data 

i saved this prompt on the main folder of the applicaiton names prompt.md 
make sure to analyse it a deepa anlyse and app for application all what i requested then make sure when you ended all the phases and all the prompts return to the prompta nd verify the application if you did not forget anything 
make sure do not stop until you end all the prompts 