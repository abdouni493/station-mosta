/**
 * ─── Shared modals & helpers for module pages ──────────────────────────────────
 * ProductModal / ContactModal are reused across Stock, Purchases, Production and
 * POS so the "create new product / client / supplier" experience is identical
 * everywhere the prompt requires it.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useState } from 'react';
import { Package, Printer, RefreshCw, User, Truck, Wallet } from 'lucide-react';
import { newId, formatCurrency } from '@/src/lib/utils';
const fc = (n: number) => formatCurrency(Number.isFinite(n) ? n : 0);
import { BizApi } from '@/src/store/BizContext';
import { BizProduct, BizContact } from '@/src/lib/bizConfig';
import { Modal, Field, Input, Textarea, Select, Switch, InlineCreate } from '@/src/components/biz/Kit';

// ─── Barcode helpers ──────────────────────────────────────────────────────────
export function genBarcode(): string {
  let code = '61';
  for (let i = 0; i < 11; i++) code += Math.floor(Math.random() * 10);
  return code;
}

export function printBarcode(product: { name: string; barcode?: string; salePrice?: number }) {
  const bars = (product.barcode || '')
    .split('')
    .map((d) => `<span style="display:inline-block;width:${1 + (parseInt(d) % 3)}px;height:60px;background:#000;margin-right:1px"></span>`)
    .join('');
  const win = window.open('', '_blank', 'width=400,height=300');
  if (!win) return;
  win.document.write(`
    <html><head><title>Code-barres</title></head>
    <body style="font-family:monospace;text-align:center;padding:24px">
      <div style="font-weight:800;margin-bottom:8px">${product.name}</div>
      <div style="white-space:nowrap;line-height:0">${bars}</div>
      <div style="letter-spacing:3px;margin-top:6px;font-size:14px">${product.barcode || ''}</div>
      ${product.salePrice ? `<div style="margin-top:8px;font-weight:700">${product.salePrice.toFixed(2)} DA</div>` : ''}
      <script>window.onload=()=>{window.print();}</script>
    </body></html>`);
  win.document.close();
}

// ─── Empty product template ────────────────────────────────────────────────────
export function emptyProduct(): Partial<BizProduct> {
  return {
    name: '', description: '', barcode: '', marqueId: '', categoryId: '',
    principalQty: 0, currentQty: 0, minQty: 5, purchasePrice: 0, salePrice: 0,
    unit: 'unité', hasExpiration: false, expirationDate: '',
  };
}

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

  React.useEffect(() => { setForm(initial || emptyProduct()); }, [initial, open]);

  const set = (k: keyof BizProduct, v: any) => setForm(f => ({ ...f, [k]: v }));

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
      createdAt: form.createdAt || new Date().toISOString(),
    };
    if (isEdit) biz.update('products', product); else biz.add('products', product);
    onSaved?.(product);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} icon={Package} size="lg"
      title={isEdit ? 'Modifier le produit' : 'Nouveau produit'}
      subtitle="Informations du produit"
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={save} disabled={!form.name?.trim()}>{isEdit ? 'Enregistrer' : 'Créer'}</button>
      </>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <Field label="Nom du produit" required>
            <Input value={form.name || ''} onChange={e => set('name', e.target.value)} placeholder="Ex: Huile de table" />
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
    <Modal open={open} onClose={onClose} icon={isSupplier ? Truck : User} size="md"
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
    <Modal open={open} onClose={onClose} icon={Wallet} size="md" title={title} subtitle="Encaissement d'un règlement partiel ou total"
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn-primary" onClick={() => { if (amount > 0) onPay(Number(amount)); }} disabled={!amount || amount <= 0}>Enregistrer le paiement</button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Total</p><p className="font-black text-slate-700 tabular-nums text-sm">{fc(total)}</p></div>
          <div className="rounded-xl bg-emerald-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Déjà payé</p><p className="font-black text-emerald-600 tabular-nums text-sm">{fc(alreadyPaid)}</p></div>
          <div className="rounded-xl bg-red-50 p-3 text-center"><p className="text-[10px] uppercase font-bold text-slate-400">Reste</p><p className="font-black text-red-600 tabular-nums text-sm">{fc(rest)}</p></div>
        </div>
        <Field label="Montant à payer cette fois (DA)">
          <Input type="number" value={amount} onChange={e => setAmount(Number(e.target.value))} max={rest} />
        </Field>
        <div className="rounded-xl bg-[#001f5c] text-white p-4 flex items-center justify-between">
          <span className="text-sm font-semibold text-blue-200">Nouveau reste</span>
          <span className="text-xl font-black tabular-nums text-[#FFB800]">{fc(newRest)}</span>
        </div>
      </div>
    </Modal>
  );
}

// ─── Invoice print helper ───────────────────────────────────────────────────────
export function printInvoice(opts: {
  title: string; ref: string; date: string; store?: string;
  party?: { label: string; name: string; phone?: string; address?: string };
  items: { name: string; qty: number; unitPrice: number; total: number }[];
  total: number; paid: number; rest: number;
}) {
  const rows = opts.items.map(it => `<tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${it.name}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${it.qty}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${it.unitPrice.toFixed(2)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${it.total.toFixed(2)}</td>
    </tr>`).join('');
  const win = window.open('', '_blank', 'width=800,height=900');
  if (!win) return;
  win.document.write(`<html><head><title>${opts.title} ${opts.ref}</title></head>
    <body style="font-family:Arial,sans-serif;color:#1e293b;padding:32px;max-width:720px;margin:auto">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #003087;padding-bottom:16px;margin-bottom:20px">
        <div><h1 style="margin:0;color:#003087;font-size:22px">${opts.store || 'altech station'}</h1>
          <p style="margin:4px 0 0;color:#64748b;font-size:13px">Naftal System</p></div>
        <div style="text-align:right"><h2 style="margin:0;color:#FFB800;font-size:20px">${opts.title}</h2>
          <p style="margin:4px 0 0;font-weight:700">${opts.ref}</p>
          <p style="margin:2px 0 0;color:#64748b;font-size:13px">${new Date(opts.date).toLocaleString('fr-DZ')}</p></div>
      </div>
      ${opts.party ? `<div style="background:#f8fafc;border-radius:10px;padding:14px;margin-bottom:18px">
        <p style="margin:0;font-size:11px;text-transform:uppercase;color:#94a3b8;font-weight:700">${opts.party.label}</p>
        <p style="margin:4px 0 0;font-weight:700;font-size:15px">${opts.party.name}</p>
        ${opts.party.phone ? `<p style="margin:2px 0 0;color:#64748b;font-size:13px">Tél: ${opts.party.phone}</p>` : ''}
        ${opts.party.address ? `<p style="margin:2px 0 0;color:#64748b;font-size:13px">${opts.party.address}</p>` : ''}
      </div>` : ''}
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead><tr style="background:#003087;color:#fff">
          <th style="padding:10px;text-align:left">Désignation</th><th style="padding:10px">Qté</th>
          <th style="padding:10px;text-align:right">P.U (DA)</th><th style="padding:10px;text-align:right">Total (DA)</th>
        </tr></thead><tbody>${rows}</tbody></table>
      <div style="margin-top:18px;margin-left:auto;width:260px">
        <div style="display:flex;justify-content:space-between;padding:6px 0"><span>Total</span><strong>${opts.total.toFixed(2)} DA</strong></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;color:#059669"><span>Payé</span><strong>${opts.paid.toFixed(2)} DA</strong></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;color:#dc2626;border-top:2px solid #003087"><span>Reste</span><strong>${opts.rest.toFixed(2)} DA</strong></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:60px">
        <div style="text-align:center"><div style="border-top:1px solid #94a3b8;width:180px;padding-top:6px;font-size:12px;color:#64748b">Signature Client</div></div>
        <div style="text-align:center"><div style="border-top:1px solid #94a3b8;width:180px;padding-top:6px;font-size:12px;color:#64748b">Cachet & Signature</div></div>
      </div>
      <script>window.onload=()=>window.print()</script>
    </body></html>`);
  win.document.close();
}
