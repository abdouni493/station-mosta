/**
 * ─── Photo de la facture fournisseur ──────────────────────────────────────────
 * Le champ du formulaire d'achat (choisir un fichier ou photographier) et son
 * aperçu dans la fiche de l'achat. L'image est compressée AVANT l'envoi (~2000 px,
 * < 450 Ko, toujours lisible) puis rangée dans le bucket `purchase-invoices` :
 * l'achat ne garde que son adresse — jamais l'image dans le blob biz.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import React, { useRef, useState } from 'react';
import { Camera, ImagePlus, Loader2, Trash2, RefreshCw, ExternalLink, FileImage, X } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { uploadFile, BUCKETS } from '@/src/lib/supabase';
import { IMAGE_PRESETS, compressImage } from '@/src/lib/imageCompress';

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

export function InvoiceImageField({ value, onChange, onBusy }: {
  value?: string;
  onChange: (url: string | undefined) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const pick = useRef<HTMLInputElement>(null);
  const shoot = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [gain, setGain] = useState<string | null>(null);

  const handle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';                       // re-choisir la même photo reste possible
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Choisissez une image (photo ou scan de la facture).'); return; }
    setBusy(true); onBusy?.(true);
    try {
      const small = await compressImage(file, IMAGE_PRESETS.document);
      const ext = small.name.split('.').pop() || 'jpg';
      const path = `facture_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
      // Déjà allégée : `uploadFile` n'y retouche pas (sous la taille cible).
      const url = await uploadFile(BUCKETS.PURCHASE_INVOICES, path, small, IMAGE_PRESETS.document);
      if (!url) {
        toast.error("Envoi de la facture impossible — vérifiez la connexion (ou que le stockage « purchase-invoices » existe).");
        return;
      }
      onChange(url);
      setGain(small.size < file.size ? `${kb(file.size)} → ${kb(small.size)}` : null);
      toast.success('Facture jointe');
    } finally {
      setBusy(false); onBusy?.(false);
    }
  };

  const inputs = <>
    <input ref={pick} type="file" accept="image/*" className="hidden" onChange={handle} />
    <input ref={shoot} type="file" accept="image/*" capture="environment" className="hidden" onChange={handle} />
  </>;

  if (busy) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50/50 p-6 flex flex-col items-center gap-2 text-[#003087]">
        <Loader2 className="w-7 h-7 animate-spin" />
        <p className="text-sm font-black">Compression et envoi…</p>
        <p className="text-[11px] text-slate-500">La photo est allégée avant l'envoi, elle reste lisible.</p>
      </div>
    );
  }

  if (value) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-3 flex flex-col sm:flex-row gap-3 items-stretch">
        {inputs}
        <a href={value} target="_blank" rel="noreferrer"
          className="block w-full sm:w-40 h-40 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0">
          <img src={value} alt="Facture fournisseur" className="w-full h-full object-cover" />
        </a>
        <div className="flex-1 min-w-0 flex flex-col justify-between gap-2">
          <div>
            <p className="text-sm font-black text-slate-800 flex items-center gap-1.5"><FileImage className="w-4 h-4 text-emerald-600" /> Facture jointe</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Visible dans « Voir » de cet achat.{gain ? ` Allégée : ${gain}.` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-outline !py-1.5 !text-xs" onClick={() => pick.current?.click()}>
              <RefreshCw className="w-3.5 h-3.5" /> Remplacer
            </button>
            <button type="button" className="btn-ghost !py-1.5 !text-xs text-red-600" onClick={() => { onChange(undefined); setGain(null); }}>
              <Trash2 className="w-3.5 h-3.5" /> Retirer
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      {inputs}
      <button type="button" onClick={() => pick.current?.click()}
        className="rounded-2xl border-2 border-dashed border-slate-200 hover:border-[#003087]/40 hover:bg-blue-50/40 transition-colors p-5 flex flex-col items-center gap-1.5 text-slate-500">
        <ImagePlus className="w-7 h-7 text-[#003087]" />
        <span className="text-sm font-black text-slate-700">Choisir une image</span>
        <span className="text-[11px]">Photo ou scan de la facture du fournisseur</span>
      </button>
      <button type="button" onClick={() => shoot.current?.click()}
        className="rounded-2xl border-2 border-dashed border-slate-200 hover:border-[#003087]/40 hover:bg-blue-50/40 transition-colors p-5 flex flex-col items-center gap-1.5 text-slate-500">
        <Camera className="w-7 h-7 text-[#003087]" />
        <span className="text-sm font-black text-slate-700">Prendre en photo</span>
        <span className="text-[11px]">Appareil photo du téléphone ou de la tablette</span>
      </button>
    </div>
  );
}

/** L'aperçu dans la fiche de l'achat, qui s'agrandit au clic. */
export function InvoiceImageView({ url }: { url?: string }) {
  const [zoom, setZoom] = useState(false);
  if (!url) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 p-3 text-[11px] text-slate-400 italic flex items-center gap-2">
        <FileImage className="w-4 h-4" /> Aucune facture fournisseur jointe à cet achat.
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase font-black text-slate-400 flex items-center gap-1.5"><FileImage className="w-3.5 h-3.5" /> Facture du fournisseur</p>
        <a href={url} target="_blank" rel="noreferrer" className="text-[11px] font-black text-[#003087] inline-flex items-center gap-1 hover:underline">
          Ouvrir <ExternalLink className="w-3 h-3" />
        </a>
      </div>
      <button type="button" onClick={() => setZoom(true)} className="block w-full rounded-xl overflow-hidden bg-white border border-slate-200">
        <img src={url} alt="Facture fournisseur" loading="lazy" className="w-full max-h-72 object-contain" />
      </button>
      {zoom && (
        <div className="fixed inset-0 z-[200] bg-black/85 flex items-center justify-center p-4" onClick={() => setZoom(false)}>
          <button className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/15 text-white flex items-center justify-center" aria-label="Fermer">
            <X className="w-5 h-5" />
          </button>
          <img src={url} alt="Facture fournisseur" className="max-w-full max-h-full object-contain rounded-lg" />
        </div>
      )}
    </div>
  );
}
