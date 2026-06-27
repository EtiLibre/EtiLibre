import { db } from './_lib/firebase.js';
import { requireAuth } from './_lib/auth.js';

const PLAN_LABELS = { starter:'Starter', pro:'Pro', business:'Business', premium:'Premium' };
const PLAN_PRICES = { starter:'$2.000', pro:'$3.000', business:'$4.500', premium:'$10.500' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const payload = requireAuth(req, res);
  if (!payload) return;

  const { planKey, subId } = req.body;
  if (!planKey) return res.status(400).json({ error: 'Falta planKey' });

  const ref = db.collection('users').doc(payload.username);
  const doc = await ref.get();
  if (!doc.exists) return res.status(404).json({ error: 'Usuario no encontrado' });

  const now = new Date().toISOString();
  const invoice = {
    name:   `Suscripción ${PLAN_LABELS[planKey] || planKey} - ${new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}`,
    date:   now,
    url:    subId ? `https://www.mercadopago.com.ar/activities/detail/${subId}` : `https://www.mercadopago.com.ar/suscripciones`,
    amount: PLAN_PRICES[planKey] || '',
    source: 'mercadopago'
  };

  const prev = doc.data();
  const prevInvoices = prev.invoices || [];
  const notif = {
    id: Date.now().toString(), icon: '✅',
    title: '¡Plan activado!',
    body:  `Tu plan ${PLAN_LABELS[planKey] || planKey} fue activado correctamente. ¡Ya podés usarlo!`,
    date:  now, read: false
  };

  await ref.update({
    plan:           planKey,
    active:         true,
    mpPendingPlan:  null,
    ...(subId ? { mpSubId: subId } : {}),
    invoices:       [invoice, ...prevInvoices].slice(0, 50),
    notifications:  [notif, ...(prev.notifications || [])].slice(0, 50)
  });

  const updated = (await ref.get()).data();
  const { pass: _, ...safe } = updated;
  res.json(safe);
}
