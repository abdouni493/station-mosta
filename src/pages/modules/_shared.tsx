/**
 * ─── Shared modals & helpers for module pages ──────────────────────────────────
 * ProductModal / ContactModal are reused across Stock, Purchases, Production and
 * POS so the "create new product / client / supplier" experience is identical
 * everywhere the prompt requires it.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useState } from 'react';
import { Package, Printer, RefreshCw, User, Truck, Wallet, Upload, Image as ImageIcon, X } from 'lucide-react';
import { newId, formatCurrency } from '@/src/lib/utils';
const fc = (n: number) => formatCurrency(Number.isFinite(n) ? n : 0);
import { BizApi } from '@/src/store/BizContext';
import { BizProduct, BizContact } from '@/src/lib/bizConfig';
import { Modal, ModalPortal, Field, Input, Textarea, Select, Switch, InlineCreate } from '@/src/components/biz/Kit';
import { uploadFile } from '@/src/lib/supabase';

// ─── Barcode helpers ──────────────────────────────────────────────────────────
export function genBarcode(): string {
  let code = '61';
  for (let i = 0; i < 11; i++) code += Math.floor(Math.random() * 10);
  return code;
}

/**
 * Code 128 (subset B) symbol widths — one 6-module pattern per value (0-106).
 * Each pattern is bar/space/bar/space/bar/space; the stop symbol (106) carries an
 * extra terminating bar. This is the standard, scanner-readable Code 128 table.
 */
const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const CODE128_START_B = 104;
const CODE128_STOP = 106;

/** Turn any text into a scannable Code 128-B barcode rendered as crisp SVG. */
export function barcodeSVG(text: string, moduleWidth = 2, height = 70): string {
  // Keep only printable ASCII (32-126); Code 128-B cannot encode anything else.
  const clean = String(text).replace(/[^\x20-\x7E]/g, '');
  if (!clean) return '';
  const codes: number[] = [CODE128_START_B];
  for (const ch of clean) codes.push(ch.charCodeAt(0) - 32);
  let checksum = CODE128_START_B;
  for (let i = 1; i < codes.length; i++) checksum += codes[i] * i;
  codes.push(checksum % 103);
  codes.push(CODE128_STOP);

  const widths = codes.map((c) => CODE128_PATTERNS[c]).join('');
  const quiet = 10 * moduleWidth; // Code 128 needs a ≥10-module quiet zone each side
  let x = quiet;
  let isBar = true;
  let rects = '';
  for (const ch of widths) {
    const w = parseInt(ch, 10) * moduleWidth;
    if (isBar) rects += `<rect x="${x}" y="0" width="${w}" height="${height}"/>`;
    x += w;
    isBar = !isBar;
  }
  const total = x + quiet;
  return `<svg width="${total}" height="${height}" viewBox="0 0 ${total} ${height}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"><rect x="0" y="0" width="${total}" height="${height}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}

export function printBarcode(product: { name: string; barcode?: string; salePrice?: number }) {
  const code = (product.barcode || '').trim();
  if (!code) return;
  const svg = barcodeSVG(code);
  const price = typeof product.salePrice === 'number' && product.salePrice > 0 ? fc(product.salePrice) : '';
  const win = window.open('', '_blank', 'width=460,height=360');
  if (!win) return;
  win.document.write(`
    <html><head><title>Code-barres</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:Arial,Helvetica,sans-serif;text-align:center;padding:20px}
      .label{display:inline-block;padding:12px 16px;border:1px solid #eee;border-radius:8px}
      .name{font-weight:800;font-size:15px;margin-bottom:8px;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .bars svg{display:block;margin:0 auto}
      .code{letter-spacing:4px;margin-top:4px;font-size:13px;font-family:'Courier New',monospace}
      .price{margin-top:8px;font-weight:800;font-size:16px}
      @media print{body{padding:0}.label{border:none}}
    </style></head>
    <body>
      <div class="label">
        <div class="name">${escapeHtml(product.name || '')}</div>
        <div class="bars">${svg}</div>
        <div class="code">${escapeHtml(code)}</div>
        ${price ? `<div class="price">${escapeHtml(price)}</div>` : ''}
      </div>
      <script>window.onload=function(){window.focus();window.print();};</script>
    </body></html>`);
  win.document.close();
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

// ─── Empty product template ────────────────────────────────────────────────────
export function emptyProduct(): Partial<BizProduct> {
  return {
    name: '', description: '', barcode: '', marqueId: '', categoryId: '',
    principalQty: 0, currentQty: 0, minQty: 5, purchasePrice: 0, salePrice: 0,
    unit: 'unité', hasExpiration: false, expirationDate: '',
    sellByDetail: false, detailCapacity: 0, detailUnit: 'L', detailSalePrice: 0,
    imageUrl: '',
  };
}

/** Units a packaged product can be split into when sold au détail. */
export const DETAIL_UNITS = ['L', 'ml', 'kg', 'g', 'm', 'cm', 'unité'];

// ─── ProductModal ───────────────────────────────────────────────────────────────
export function ProductModal({
  biz, open, onClose, initial, onSaved,
}: {
  biz: BizApi; open: boolean; onClose: () => void; initial?: Partial<BizProduct> | null;
  onSaved?: (p: BizProduct) => void;
}) {
  const isEdit = !!initial?.id;
  const [form, setForm] = useState<Partial<BizProduct>>(initial || emptyProduct());
  const [showMarque, setShowMarque] = useState(false);
  const [showCat, setShowCat] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  React.useEffect(() => { setForm(initial || emptyProduct()); }, [initial, open]);

  const set = (k: keyof BizProduct, v: any) => setForm(f => ({ ...f, [k]: v }));

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const fileName = `prod_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
      const url = await uploadFile('products', fileName, file);
      if (url) {
        set('imageUrl', url);
      } else {
        const reader = new FileReader();
        reader.onloadend = () => set('imageUrl', reader.result as string);
        reader.readAsDataURL(file);
      }
    } catch {
      const reader = new FileReader();
      reader.onloadend = () => set('imageUrl', reader.result as string);
      reader.readAsDataURL(file);
    } finally {
      setUploadingImage(false);
    }
  };

  const save = () => {
    if (!form.name?.trim()) return;
    const marqueName = biz.state.marques.find(x => x.id === form.marqueId)?.name;
    const categoryName = biz.state.categories.find(x => x.id === form.categoryId)?.name;
    const product: BizProduct = {
      id: form.id || newId(),
      name: form.name!.trim(),
      description: form.description || '',
      barcode: form.barcode || '',
      marqueId: form.marqueId, marqueName,
      categoryId: form.categoryId, categoryName,
      principalQty: Number(form.principalQty) || 0,
      currentQty: form.id ? Number(form.currentQty) || 0 : Number(form.principalQty) || 0,
      minQty: Number(form.minQty) || 0,
      purchasePrice: Number(form.purchasePrice) || 0,
      salePrice: Number(form.salePrice) || 0,
      unit: form.unit || 'unité',
      hasExpiration: !!form.hasExpiration,
      expirationDate: form.hasExpiration ? form.expirationDate : undefined,
      sellByDetail: !!form.sellByDetail,
      detailCapacity: form.sellByDetail ? Number(form.detailCapacity) || 0 : undefined,
      detailUnit: form.sellByDetail ? (form.detailUnit || 'L') : undefined,
      // Left empty ⇒ the POS falls back to salePrice / detailCapacity.
      detailSalePrice: form.sellByDetail && Number(form.detailSalePrice) > 0
        ? Number(form.detailSalePrice) : undefined,
      imageUrl: form.imageUrl || undefined,
      createdAt: form.createdAt || new Date().toISOString(),
    };
    if (isEdit) biz.update('products', product); else biz.add('products', product);
    onSaved?.(product);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} icon={Package} size="xl" formScale
      title={isEdit ? 'Modifier le produit' : 'Nouveau produit'}
      subtitle="Informations du produit"
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={save} disabled={!form.name?.trim() || uploadingImage}>{isEdit ? 'Enregistrer' : 'Créer'}</button>
      </>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <Field label="Nom du produit" required>
            <Input value={form.name || ''} onChange={e => set('name', e.target.value)} placeholder="Ex: Huile de table" />
          </Field>
        </div>

        {/* Image Upload Field */}
        <div className="sm:col-span-2">
          <Field label="Photo du produit" hint="Affichée sur les cartes du point de vente (POS).">
            <div className="flex items-center gap-4 bg-slate-50 border border-slate-200 rounded-2xl p-3">
              {form.imageUrl ? (
                <div className="relative w-20 h-20 rounded-xl overflow-hidden border border-slate-200 shrink-0 bg-white shadow-sm">
                  <img src={form.imageUrl} alt="Aperçu" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => set('imageUrl', '')}
                    className="absolute top-1 right-1 bg-red-600 text-white rounded-full p-1 shadow-md hover:bg-red-700 transition-colors"
                    title="Supprimer l'image"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="w-20 h-20 rounded-xl border border-dashed border-slate-300 flex flex-col items-center justify-center bg-white text-slate-400 shrink-0">
                  <ImageIcon className="w-6 h-6 mb-1" />
                  <span className="text-[10px] font-bold">Sans image</span>
                </div>
              )}
              <div className="flex-1 space-y-1.5">
                <label className="btn-secondary !py-2 !px-3.5 inline-flex items-center gap-2 cursor-pointer text-xs font-bold">
                  <Upload className="w-4 h-4 text-[#003087]" />
                  {uploadingImage ? 'Téléchargement…' : form.imageUrl ? "Changer la photo" : 'Choisir une photo'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploadingImage}
                    onChange={handleImageChange}
                  />
                </label>
                <p className="text-[11px] text-slate-400">Stockée dans le bucket Supabase « products ».</p>
              </div>
            </div>
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Field label="Description">
            <Textarea value={form.description || ''} onChange={e => set('description', e.target.value)} placeholder="Description du produit" />
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Field label="Code-barres" hint="Générez un code si le produit n'en possède pas.">
            <div className="flex gap-2">
              <Input value={form.barcode || ''} onChange={e => set('barcode', e.target.value)} placeholder="Code-barres" />
              <button type="button" title="Générer" className="btn-secondary !px-3 shrink-0" onClick={() => set('barcode', genBarcode())}>
                <RefreshCw className="w-4 h-4" />
              </button>
              <button type="button" title="Imprimer" className="btn-outline !px-3 shrink-0" onClick={() => printBarcode(form as any)} disabled={!form.barcode}>
                <Printer className="w-4 h-4" />
              </button>
            </div>
          </Field>
        </div>

        <Field label="Marque">
          <div className="flex gap-2">
            <Select value={form.marqueId || ''} onChange={e => set('marqueId', e.target.value)}>
              <option value="">— Sélectionner —</option>
              {biz.state.marques.map(mq => <option key={mq.id} value={mq.id}>{mq.name}</option>)}
            </Select>
            <button type="button" className="btn-secondary !px-3 shrink-0" onClick={() => setShowMarque(s => !s)}>+</button>
          </div>
          {showMarque && (
            <div className="mt-2">
              <InlineCreate placeholder="Nouvelle marque" onCreate={name => {
                const it = { id: newId(), name }; biz.add('marques', it); set('marqueId', it.id); setShowMarque(false);
              }} />
            </div>
          )}
        </Field>

        <Field label="Catégorie">
          <div className="flex gap-2">
            <Select value={form.categoryId || ''} onChange={e => set('categoryId', e.target.value)}>
              <option value="">— Sélectionner —</option>
              {biz.state.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <button type="button" className="btn-secondary !px-3 shrink-0" onClick={() => setShowCat(s => !s)}>+</button>
          </div>
          {showCat && (
            <div className="mt-2">
              <InlineCreate placeholder="Nouvelle catégorie" onCreate={name => {
                const it = { id: newId(), name }; biz.add('categories', it); set('categoryId', it.id); setShowCat(false);
              }} />
            </div>
          )}
        </Field>

        <Field label="Quantité principale">
          <Input type="number" value={form.principalQty ?? 0} onChange={e => set('principalQty', e.target.value)} />
        </Field>
        {isEdit && (
          <Field label="Quantité restante">
            <Input type="number" value={form.currentQty ?? 0} onChange={e => set('currentQty', e.target.value)} />
          </Field>
        )}
        <Field label="Quantité minimale (alerte)">
          <Input type="number" value={form.minQty ?? 0} onChange={e => set('minQty', e.target.value)} />
        </Field>
        <Field label="Unité">
          <Select value={form.unit || 'unité'} onChange={e => set('unit', e.target.value)}>
            {['unité', 'kg', 'g', 'L', 'ml', 'part', 'jeu', 'boîte', 'pack'].map(u => <option key={u}>{u}</option>)}
          </Select>
        </Field>
        <Field label="Prix d'achat (DA)">
          <Input type="number" value={form.purchasePrice ?? 0} onChange={e => set('purchasePrice', e.target.value)} />
        </Field>
        <Field label="Prix de vente (DA)">
          <Input type="number" value={form.salePrice ?? 0} onChange={e => set('salePrice', e.target.value)} />
        </Field>

        <div className="sm:col-span-2 flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
          <div>
            <p className="text-sm font-bold text-slate-700">Date d'expiration</p>
            <p className="text-xs text-slate-400">Activez pour suivre la péremption</p>
          </div>
          <Switch checked={!!form.hasExpiration} onChange={v => set('hasExpiration', v)} />
        </div>
        {form.hasExpiration && (
          <div className="sm:col-span-2">
            <Field label="Date d'expiration">
              <Input type="date" value={form.expirationDate || ''} onChange={e => set('expirationDate', e.target.value)} />
            </Field>
          </div>
        )}

        {/* ── Vente au détail ───────────────────────────────────────────────
            One packaged unit (a 50 L drum, a 25 kg sack…) can be sold litre by
            litre. The POS then deducts the fraction actually sold from stock. */}
        <div className="sm:col-span-2 flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
          <div>
            <p className="text-sm font-bold text-slate-700">Vente au détail</p>
            <p className="text-xs text-slate-400">Vendre une fraction d'une unité (ex: 1 L sur un bidon de 50 L)</p>
          </div>
          <Switch checked={!!form.sellByDetail} onChange={v => set('sellByDetail', v)} />
        </div>
        {form.sellByDetail && (
          <>
            <Field label="Contenance d'une unité" required hint="Ex: 50 pour un bidon de 50 litres">
              <Input type="number" value={form.detailCapacity ?? 0} onChange={e => set('detailCapacity', e.target.value)} />
            </Field>
            <Field label="Unité de détail">
              <Select value={form.detailUnit || 'L'} onChange={e => set('detailUnit', e.target.value)}>
                {DETAIL_UNITS.map(u => <option key={u}>{u}</option>)}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label={`Prix de vente d'un ${form.detailUnit || 'L'} (DA)`}
                hint={`Laissez à 0 pour utiliser ${Number(form.salePrice) || 0} ÷ ${Number(form.detailCapacity) || 0} automatiquement.`}>
                <Input type="number" value={form.detailSalePrice ?? 0} onChange={e => set('detailSalePrice', e.target.value)} />
              </Field>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ─── ContactModal (client / supplier) ──────────────────────────────────────────
export function ContactModal({
  biz, coll, open, onClose, initial, onSaved,
}: {
  biz: BizApi; coll: 'clients' | 'suppliers'; open: boolean; onClose: () => void;
  initial?: Partial<BizContact> | null; onSaved?: (c: BizContact) => void;
}) {
  const isSupplier = coll === 'suppliers';
  const isEdit = !!initial?.id;
  const [form, setForm] = useState<Partial<BizContact>>(initial || { name: '', phone: '', address: '' });
  React.useEffect(() => { setForm(initial || { name: '', phone: '', address: '' }); }, [initial, open]);

  const save = () => {
    if (!form.name?.trim()) return;
    const contact: BizContact = {
      id: form.id || newId(),
      name: form.name!.trim(),
      phone: form.phone || '',
      address: form.address || '',
      createdAt: form.createdAt || new Date().toISOString(),
    };
    if (isEdit) biz.update(coll, contact); else biz.add(coll, contact);
    onSaved?.(contact);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} icon={isSupplier ? Truck : User} size="lg" formScale
      title={isEdit ? (isSupplier ? 'Modifier le fournisseur' : 'Modifier le client') : (isSupplier ? 'Nouveau fournisseur' : 'Nouveau client')}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={save} disabled={!form.name?.trim()}>{isEdit ? 'Enregistrer' : 'Créer'}</button>
      </>}>
      <div className="space-y-4">
        <Field label="Nom" required><Input value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Nom complet" /></Field>
        <Field label="Téléphone"><Input value={form.phone || ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="0550 00 00 00" /></Field>
        <Field label="Adresse"><Textarea value={form.address || ''} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Adresse" /></Field>
      </div>
    </Modal>
  );
}

// ─── Product picker (search products in stock) ─────────────────────────────────
export function useProductSearch(products: BizProduct[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return products;
  return products.filter(p => p.name.toLowerCase().includes(q) || (p.barcode || '').includes(q) || (p.description || '').toLowerCase().includes(q));
}

// ─── PayDebtModal ───────────────────────────────────────────────────────────────
export function PayDebtModal({
  open, onClose, total, alreadyPaid, onPay, title = 'Payer la dette',
}: {
  open: boolean; onClose: () => void; total: number; alreadyPaid: number;
  onPay: (amount: number) => void; title?: string;
}) {
  const rest = Math.max(0, total - alreadyPaid);
  const [amount, setAmount] = useState<number>(rest);
  React.useEffect(() => { setAmount(rest); }, [rest, open]);
  const newRest = Math.max(0, rest - (Number(amount) || 0));

  return (
    <Modal open={open} onClose={onClose} icon={Wallet} size="lg" formScale title={title} subtitle="Encaissement d'un règlement partiel ou total"
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={() => { if (amount > 0) onPay(Number(amount)); }} disabled={!amount || amount <= 0}>Enregistrer le paiement</button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-center"><p className="text-[10px] uppercase font-black text-slate-400">Total</p><p className="font-black text-slate-700 tabular-nums text-sm sm:text-base">{fc(total)}</p></div>
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-center"><p className="text-[10px] uppercase font-black text-slate-400">Déjà payé</p><p className="font-black text-emerald-600 tabular-nums text-sm sm:text-base">{fc(alreadyPaid)}</p></div>
          <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-center"><p className="text-[10px] uppercase font-black text-slate-400">Reste</p><p className="font-black text-red-600 tabular-nums text-sm sm:text-base">{fc(rest)}</p></div>
        </div>
        <Field label="Montant à payer cette fois (DA)">
          <Input type="number" inputMode="decimal" value={amount}
            onChange={e => setAmount(Number(e.target.value))} max={rest} className="text-right" />
        </Field>
        <div className="rounded-2xl bg-[#001f5c] text-white p-4 sm:p-5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold text-blue-200">Nouveau reste</span>
          <span className="text-2xl font-black tabular-nums text-[#FFB800]">{fc(newRest)}</span>
        </div>
      </div>
    </Modal>
  );
}

// ─── Invoice print helper ───────────────────────────────────────────────────────

/** Identity of the station, printed in the header of every document. */
export interface PrintStation {
  name?: string;
  logoUrl?: string;
  address?: string;
  phone?: string;
  email?: string;
  fiscalId?: string;
  rc?: string;
}

export interface PrintPaymentLine {
  label: string;      // "Espèces", "BNA — chèque 445221"…
  amount: number;
  reference?: string;
}

export interface PrintInvoiceOptions {
  title: string;
  ref: string;
  date: string;
  station?: PrintStation;
  /** @deprecated pass `station` instead — kept so old call sites keep compiling. */
  store?: string;
  party?: { label: string; name: string; phone?: string; address?: string };
  /** Free-form blocks printed under the party (vehicle, session, worker…). */
  info?: { label: string; value: string }[];
  items: { name: string; qty: number | string; unitPrice: number; total: number }[];
  subtotal?: number;
  reduction?: number;
  tva?: number;
  total: number;
  paid: number;
  rest: number;
  payments?: PrintPaymentLine[];
  notes?: string;
  footerNote?: string;
}

const esc = (v: unknown) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dz = (n: number) => (Number.isFinite(n) ? n : 0).toFixed(2);

export function printInvoice(opts: PrintInvoiceOptions) {
  const st = opts.station || {};
  const stationName = st.name || opts.store || 'altech station';

  const rows = opts.items.map(it => `<tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${esc(it.name)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${esc(it.qty)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${dz(it.unitPrice)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${dz(it.total)}</td>
    </tr>`).join('');

  const totalLine = (label: string, value: string, color = '#1e293b', border = '') =>
    `<div style="display:flex;justify-content:space-between;padding:6px 0;color:${color};${border}">
       <span>${esc(label)}</span><strong>${value} DA</strong></div>`;

  const infoBlocks = (opts.info || []).filter(i => i.value).map(i => `
    <div style="background:#f8fafc;border-radius:10px;padding:10px 14px">
      <p style="margin:0;font-size:10px;text-transform:uppercase;color:#94a3b8;font-weight:700">${esc(i.label)}</p>
      <p style="margin:3px 0 0;font-weight:700;font-size:13px">${esc(i.value)}</p>
    </div>`).join('');

  const paymentRows = (opts.payments || []).filter(p => p.amount > 0).map(p => `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(p.label)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;color:#64748b">${esc(p.reference || '—')}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right"><strong>${dz(p.amount)} DA</strong></td>
    </tr>`).join('');

  const win = window.open('', '_blank', 'width=820,height=920');
  if (!win) return;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(opts.title)} ${esc(opts.ref)}</title></head>
    <body style="font-family:Arial,Helvetica,sans-serif;color:#1e293b;padding:32px;max-width:760px;margin:auto">

      <!-- Header: station identity + document -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #003087;padding-bottom:16px;margin-bottom:18px;gap:16px">
        <div style="display:flex;gap:12px;align-items:flex-start">
          ${st.logoUrl ? `<img src="${esc(st.logoUrl)}" alt="" style="width:58px;height:58px;object-fit:cover;border-radius:12px">` : ''}
          <div>
            <h1 style="margin:0;color:#003087;font-size:21px">${esc(stationName)}</h1>
            ${st.address ? `<p style="margin:3px 0 0;color:#64748b;font-size:12px">${esc(st.address)}</p>` : ''}
            ${st.phone ? `<p style="margin:2px 0 0;color:#64748b;font-size:12px">Tél: ${esc(st.phone)}</p>` : ''}
            ${st.email ? `<p style="margin:2px 0 0;color:#64748b;font-size:12px">${esc(st.email)}</p>` : ''}
            ${(st.fiscalId || st.rc) ? `<p style="margin:2px 0 0;color:#94a3b8;font-size:11px">
              ${st.fiscalId ? `NIF: ${esc(st.fiscalId)}` : ''}${st.fiscalId && st.rc ? ' • ' : ''}${st.rc ? `RC: ${esc(st.rc)}` : ''}</p>` : ''}
          </div>
        </div>
        <div style="text-align:right;white-space:nowrap">
          <h2 style="margin:0;color:#FFB800;font-size:19px">${esc(opts.title)}</h2>
          <p style="margin:4px 0 0;font-weight:700">${esc(opts.ref)}</p>
          <p style="margin:2px 0 0;color:#64748b;font-size:12px">${new Date(opts.date).toLocaleString('fr-DZ')}</p>
        </div>
      </div>

      ${opts.party ? `<div style="background:#f8fafc;border-radius:10px;padding:14px;margin-bottom:12px">
        <p style="margin:0;font-size:11px;text-transform:uppercase;color:#94a3b8;font-weight:700">${esc(opts.party.label)}</p>
        <p style="margin:4px 0 0;font-weight:700;font-size:15px">${esc(opts.party.name)}</p>
        ${opts.party.phone ? `<p style="margin:2px 0 0;color:#64748b;font-size:13px">Tél: ${esc(opts.party.phone)}</p>` : ''}
        ${opts.party.address ? `<p style="margin:2px 0 0;color:#64748b;font-size:13px">${esc(opts.party.address)}</p>` : ''}
      </div>` : ''}

      ${infoBlocks ? `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:16px">${infoBlocks}</div>` : ''}

      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#003087;color:#fff">
          <th style="padding:10px;text-align:left">Désignation</th><th style="padding:10px">Qté</th>
          <th style="padding:10px;text-align:right">P.U (DA)</th><th style="padding:10px;text-align:right">Total (DA)</th>
        </tr></thead><tbody>${rows || '<tr><td colspan="4" style="padding:12px;color:#94a3b8">Aucune ligne</td></tr>'}</tbody></table>

      <div style="margin-top:16px;margin-left:auto;width:280px;font-size:13px">
        ${opts.subtotal !== undefined ? totalLine('Sous-total', dz(opts.subtotal)) : ''}
        ${opts.reduction ? totalLine('Remise', `- ${dz(opts.reduction)}`, '#b45309') : ''}
        ${opts.tva ? totalLine('TVA', dz(opts.tva)) : ''}
        ${totalLine('Total', dz(opts.total), '#003087', 'border-top:2px solid #003087;font-size:15px')}
        ${totalLine('Payé', dz(opts.paid), '#059669')}
        ${totalLine('Reste', dz(opts.rest), '#dc2626')}
      </div>

      ${paymentRows ? `<div style="margin-top:22px">
        <p style="margin:0 0 6px;font-size:11px;text-transform:uppercase;color:#94a3b8;font-weight:700">Détail du paiement</p>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:#f1f5f9;color:#475569">
            <th style="padding:6px 8px;text-align:left">Mode</th>
            <th style="padding:6px 8px;text-align:left">Référence</th>
            <th style="padding:6px 8px;text-align:right">Montant</th>
          </tr></thead><tbody>${paymentRows}</tbody></table>
      </div>` : ''}

      ${opts.notes ? `<div style="margin-top:18px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px">
        <p style="margin:0;font-size:11px;text-transform:uppercase;color:#b45309;font-weight:700">Observations</p>
        <p style="margin:4px 0 0;font-size:13px">${esc(opts.notes)}</p></div>` : ''}

      <div style="display:flex;justify-content:space-between;margin-top:56px">
        <div style="text-align:center"><div style="border-top:1px solid #94a3b8;width:180px;padding-top:6px;font-size:12px;color:#64748b">Signature Client</div></div>
        <div style="text-align:center"><div style="border-top:1px solid #94a3b8;width:180px;padding-top:6px;font-size:12px;color:#64748b">Cachet &amp; Signature</div></div>
      </div>
      <p style="margin-top:26px;text-align:center;color:#94a3b8;font-size:11px">
        ${esc(opts.footerNote || `${stationName} — Merci de votre confiance.`)}</p>

      <script>window.onload=()=>window.print()</script>
    </body></html>`);
  win.document.close();
}

// ─── Payment receipt (reçu de règlement) ────────────────────────────────────────
/**
 * Receipt handed to a client (or kept by the station) when a debt instalment is
 * collected. Same visual language as `printInvoice`, but the body is the
 * movement itself — dette avant → montant réglé → dette après — instead of a
 * list of articles.
 */
export interface PrintReceiptOptions {
  /** Document title, e.g. "Reçu de règlement". */
  title?: string;
  /** Receipt number printed top-right. */
  ref: string;
  date: string;
  station?: PrintStation;
  party?: { label: string; name: string; phone?: string; address?: string };
  /** Extra blocks under the party (N° facture, encaissé par…). */
  info?: { label: string; value: string }[];
  amount: number;
  /** Payment mode: Espèces / Chèque / Virement. */
  mode?: string;
  /** Cheque or transfer number. */
  reference?: string;
  /** Debt before and after the payment, printed as the receipt's summary. */
  debtBefore?: number;
  debtAfter?: number;
  notes?: string;
  footerNote?: string;
}

export function printPaymentReceipt(opts: PrintReceiptOptions) {
  const st = opts.station || {};
  const stationName = st.name || 'altech station';
  const title = opts.title || 'Reçu de règlement';

  const infoBlocks = (opts.info || []).filter(i => i.value).map(i => `
    <div style="background:#f8fafc;border-radius:10px;padding:10px 14px">
      <p style="margin:0;font-size:10px;text-transform:uppercase;color:#94a3b8;font-weight:700">${esc(i.label)}</p>
      <p style="margin:3px 0 0;font-weight:700;font-size:13px">${esc(i.value)}</p>
    </div>`).join('');

  const row = (label: string, value: string, color = '#1e293b', extra = '') =>
    `<div style="display:flex;justify-content:space-between;padding:8px 0;color:${color};${extra}">
       <span>${esc(label)}</span><strong>${value} DA</strong></div>`;

  const win = window.open('', '_blank', 'width=820,height=920');
  if (!win) return;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} ${esc(opts.ref)}</title></head>
    <body style="font-family:Arial,Helvetica,sans-serif;color:#1e293b;padding:32px;max-width:760px;margin:auto">

      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #003087;padding-bottom:16px;margin-bottom:18px;gap:16px">
        <div style="display:flex;gap:12px;align-items:flex-start">
          ${st.logoUrl ? `<img src="${esc(st.logoUrl)}" alt="" style="width:58px;height:58px;object-fit:cover;border-radius:12px">` : ''}
          <div>
            <h1 style="margin:0;color:#003087;font-size:21px">${esc(stationName)}</h1>
            ${st.address ? `<p style="margin:3px 0 0;color:#64748b;font-size:12px">${esc(st.address)}</p>` : ''}
            ${st.phone ? `<p style="margin:2px 0 0;color:#64748b;font-size:12px">Tél: ${esc(st.phone)}</p>` : ''}
            ${(st.fiscalId || st.rc) ? `<p style="margin:2px 0 0;color:#94a3b8;font-size:11px">
              ${st.fiscalId ? `NIF: ${esc(st.fiscalId)}` : ''}${st.fiscalId && st.rc ? ' • ' : ''}${st.rc ? `RC: ${esc(st.rc)}` : ''}</p>` : ''}
          </div>
        </div>
        <div style="text-align:right;white-space:nowrap">
          <h2 style="margin:0;color:#FFB800;font-size:19px">${esc(title)}</h2>
          <p style="margin:4px 0 0;font-weight:700">${esc(opts.ref)}</p>
          <p style="margin:2px 0 0;color:#64748b;font-size:12px">${new Date(opts.date).toLocaleString('fr-DZ')}</p>
        </div>
      </div>

      ${opts.party ? `<div style="background:#f8fafc;border-radius:10px;padding:14px;margin-bottom:12px">
        <p style="margin:0;font-size:11px;text-transform:uppercase;color:#94a3b8;font-weight:700">${esc(opts.party.label)}</p>
        <p style="margin:4px 0 0;font-weight:700;font-size:15px">${esc(opts.party.name)}</p>
        ${opts.party.phone ? `<p style="margin:2px 0 0;color:#64748b;font-size:13px">Tél: ${esc(opts.party.phone)}</p>` : ''}
        ${opts.party.address ? `<p style="margin:2px 0 0;color:#64748b;font-size:13px">${esc(opts.party.address)}</p>` : ''}
      </div>` : ''}

      ${infoBlocks ? `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:16px">${infoBlocks}</div>` : ''}

      <!-- Le montant encaissé : l'information principale du reçu -->
      <div style="background:#003087;color:#fff;border-radius:12px;padding:20px 24px;display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
        <div>
          <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#bfdbfe;font-weight:700">Montant encaissé</p>
          <p style="margin:6px 0 0;font-size:12px;color:#bfdbfe">
            ${esc(opts.mode || 'Espèces')}${opts.reference ? ` — ${esc(opts.reference)}` : ''}
          </p>
        </div>
        <span style="font-size:30px;font-weight:800;color:#FFB800">${dz(opts.amount)} DA</span>
      </div>

      ${(opts.debtBefore !== undefined || opts.debtAfter !== undefined) ? `
        <div style="margin-left:auto;width:300px;font-size:13px">
          ${opts.debtBefore !== undefined ? row('Dette avant règlement', dz(opts.debtBefore), '#64748b') : ''}
          ${row('Montant réglé', `- ${dz(opts.amount)}`, '#059669')}
          ${opts.debtAfter !== undefined ? row('Reste dû', dz(opts.debtAfter), '#dc2626', 'border-top:2px solid #003087;font-size:15px') : ''}
        </div>` : ''}

      ${opts.notes ? `<div style="margin-top:18px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px">
        <p style="margin:0;font-size:11px;text-transform:uppercase;color:#b45309;font-weight:700">Observations</p>
        <p style="margin:4px 0 0;font-size:13px">${esc(opts.notes)}</p></div>` : ''}

      <div style="display:flex;justify-content:space-between;margin-top:56px">
        <div style="text-align:center"><div style="border-top:1px solid #94a3b8;width:180px;padding-top:6px;font-size:12px;color:#64748b">Signature Client</div></div>
        <div style="text-align:center"><div style="border-top:1px solid #94a3b8;width:180px;padding-top:6px;font-size:12px;color:#64748b">Cachet &amp; Signature</div></div>
      </div>
      <p style="margin-top:26px;text-align:center;color:#94a3b8;font-size:11px">
        ${esc(opts.footerNote || `${stationName} — Reçu faisant foi de règlement.`)}</p>

      <script>window.onload=()=>window.print()</script>
    </body></html>`);
  win.document.close();
}

// ─── "Imprimer la facture ?" prompt ─────────────────────────────────────────────
/**
 * Small confirmation shown right after a sale / lavage / réparation is saved, so
 * the user decides whether the document is printed.
 */
export function AskPrintModal({
  open, title = 'Imprimer la facture ?', message, onPrint, onSkip,
}: {
  open: boolean; title?: string; message?: string;
  onPrint: () => void; onSkip: () => void;
}) {
  if (!open) return null;
  return (
    <ModalPortal>
    <div className="modal-shell" style={{ zIndex: 80 }} onClick={onSkip}>
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
      <div className="modal-box modal-box-anim max-w-sm relative z-10" onClick={e => e.stopPropagation()}>
        <div className="p-6">
          <div className="w-12 h-12 rounded-2xl bg-blue-100 flex items-center justify-center mb-4">
            <Printer className="w-6 h-6 text-[#003087]" />
          </div>
          <h3 className="text-base font-black text-[#002d87] mb-2">{title}</h3>
          <p className="text-sm text-slate-500">
            {message || 'Le document reprend les informations de la station, du client et du paiement.'}
          </p>
        </div>
        <div className="p-6 pt-0 flex gap-3">
          <button onClick={onSkip} className="btn-ghost flex-1">Non, merci</button>
          <button onClick={onPrint} className="btn-primary flex-1">
            <Printer className="w-4 h-4" /> Imprimer
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

/** Maps the app's station settings onto the print header shape. */
export function stationFromSettings(settings: any): PrintStation {
  return {
    name: settings?.stationName || settings?.name,
    logoUrl: settings?.logoUrl || settings?.logo,
    address: settings?.address,
    phone: settings?.phone,
    email: settings?.email,
    fiscalId: settings?.fiscalId,
    rc: settings?.rc,
  };
}
