import React, { useState } from 'react';
import { Wrench, Plus, Tag } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { newId } from '@/src/lib/utils';
import { ModuleKey, MODULES, BizService } from '@/src/lib/bizConfig';
import { useBiz } from '@/src/store/BizContext';
import { useBizPermission } from '@/src/store/AppContext';
import {
  PageHeader, StatCard, SearchInput, CardGrid, GlassCard, EmptyState,
  RowActions, ActionBtn, Edit2, Trash2, Confirm, Modal, Field, Input, Textarea, money,
} from '@/src/components/biz/Kit';

export default function ModuleServices({ moduleKey }: { moduleKey: ModuleKey }) {
  const cfg = MODULES[moduleKey];
  const biz = useBiz(moduleKey);
  const perm = useBizPermission(moduleKey, 'services');
  const { services } = biz.state;
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<BizService | null | 'new'>(null);
  const [toDelete, setToDelete] = useState<BizService | null>(null);

  const filtered = services.filter(s => !search || s.name.toLowerCase().includes(search.toLowerCase()));
  const del = () => { if (toDelete) { biz.remove('services', toDelete.id); toast.success('Service supprimé'); setToDelete(null); } };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader icon={Wrench} title="Services" subtitle={`${cfg.label} — prestations proposées`}
        actions={perm.creer ? <button className="btn-primary" onClick={() => setForm('new')}><Plus className="w-4 h-4" /> Nouveau service</button> : undefined} />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard icon={Wrench} label="Services" value={services.length} tone="blue" />
        <StatCard icon={Tag} label="Prix moyen" value={money(services.length ? services.reduce((s, x) => s + x.price, 0) / services.length : 0)} tone="green" />
        <StatCard icon={Tag} label="Prix max" value={money(Math.max(0, ...services.map(s => s.price)))} tone="purple" />
      </div>

      <div className="card-glass p-4"><SearchInput value={search} onChange={setSearch} placeholder="Nom du service…" /></div>

      {filtered.length === 0 ? <EmptyState icon={Wrench} title="Aucun service" action={perm.creer ? <button className="btn-primary" onClick={() => setForm('new')}><Plus className="w-4 h-4" /> Nouveau service</button> : undefined} /> : (
        <CardGrid>
          {filtered.map(s => (
            <GlassCard key={s.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><h3 className="font-black text-slate-800">{s.name}</h3>{s.description && <p className="text-xs text-slate-400 mt-1 line-clamp-2">{s.description}</p>}</div>
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                <span className="font-black text-[#002d87] tabular-nums text-lg">{money(s.price)}</span>
                <RowActions>
                  {perm.modifier && <ActionBtn icon={Edit2} tone="amber" title="Modifier" onClick={() => setForm(s)} />}
                  {perm.supprimer && <ActionBtn icon={Trash2} tone="red" title="Supprimer" onClick={() => setToDelete(s)} />}
                </RowActions>
              </div>
            </GlassCard>
          ))}
        </CardGrid>
      )}

      {form && <ServiceForm moduleKey={moduleKey} initial={form === 'new' ? null : form} onClose={() => setForm(null)} />}
      <Confirm open={!!toDelete} title="Supprimer le service" message={`Supprimer « ${toDelete?.name} » ?`} onConfirm={del} onCancel={() => setToDelete(null)} />
    </div>
  );
}

function ServiceForm({ moduleKey, initial, onClose }: { moduleKey: ModuleKey; initial: BizService | null; onClose: () => void }) {
  const biz = useBiz(moduleKey);
  const isEdit = !!initial;
  const [f, setF] = useState<Partial<BizService>>(initial || { name: '', description: '', price: 0 });
  const save = () => {
    if (!f.name?.trim()) { toast.error('Nom requis'); return; }
    const svc: BizService = { id: initial?.id || newId(), name: f.name!.trim(), description: f.description, price: Number(f.price) || 0 };
    if (isEdit) biz.update('services', svc); else biz.add('services', svc);
    toast.success(isEdit ? 'Service modifié' : 'Service créé'); onClose();
  };
  return (
    <Modal open onClose={onClose} icon={Wrench} size="md" title={isEdit ? 'Modifier le service' : 'Nouveau service'}
      footer={<><button className="btn-ghost" onClick={onClose}>Annuler</button><button className="btn-primary" onClick={save}>{isEdit ? 'Enregistrer' : 'Créer'}</button></>}>
      <div className="space-y-4">
        <Field label="Nom" required><Input value={f.name || ''} onChange={e => setF(p => ({ ...p, name: e.target.value }))} /></Field>
        <Field label="Prix (DA)"><Input type="number" value={f.price ?? 0} onChange={e => setF(p => ({ ...p, price: Number(e.target.value) }))} /></Field>
        <Field label="Description"><Textarea value={f.description || ''} onChange={e => setF(p => ({ ...p, description: e.target.value }))} /></Field>
      </div>
    </Modal>
  );
}
