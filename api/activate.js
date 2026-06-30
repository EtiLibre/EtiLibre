import { db } from './_lib/firebase.js';
import { requireAuth } from './_lib/auth.js';

const PLAN_IDS = {
  starter:  '4f3cbb4d7b7643ccac2f4c5d06353e2c',
  pro:      '8249ed9006064842b67ece3d76b38e0a',
  business: '472deed04ef0404682fd78048a5324e0',
  premium:  '55add3001b744fbab79927fe89c1c28f'
};
const PLAN_LABELS = { starter:'Starter', pro:'Pro', business:'Business', premium:'Premium' };
const PLAN_PRICES = { starter:'$2.000', pro:'$3.000', business:'$4.500', premium:'$10.500' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://etify.com.ar');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const payload = requireAuth(req, res);
  if (!payload) return;

  const { planKey, subId } = req.body;
  if (!planKey) return res.status(400).json({ error: 'Falta planKey' });
  if (!PLAN_IDS[planKey]) return res.status(400).json({ error: 'Plan inválido' });

  // Verificar con MercadoPago que la suscripción realmente existe y está autorizada
  if (!subId) return res.status(400).json({ error: 'Falta subId' });
  try {
    const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${subId}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
    });
    if (!mpRes.ok) return res.status(400).json({ error: 'Suscripción no encontrada en MercadoPago' });
    const sub = await mpRes.json();
    // Verificar que la suscripción está autorizada y corresponde al plan correcto
    if (sub.status !== 'authorized') return res.status(400).json({ error: 'La suscripción no está autorizada' });
    if (sub.preapproval_plan_id !== PLAN_IDS[planKey]) return res.status(400).json({ error: 'El plan no coincide con la suscripción' });
    // Verificar ownership: external_reference debe ser el usuario, o el email del pagador debe coincidir
    const userDoc = await db.collection('users').doc(payload.username).get();
    const userEmail = userDoc.exists ? userDoc.data().email : null;
    const subEmail  = sub.payer_email || sub.payer?.email;
    const ownsRef   = sub.external_reference === payload.username;
    const ownsEmail = userEmail && subEmail && subEmail.toLowerCase() === userEmail.toLowerCase();
    if (!ownsRef && !ownsEmail) return res.status(403).json({ error: 'Esta suscripción no pertenece a tu cuenta' });
  } catch (e) {
    if (e.message?.includes('pertenece')) return res.status(403).json({ error: e.message });
    return res.status(500).json({ error: 'No se pudo verificar con MercadoPago' });
  }

  const ref = db.collection('users').doc(payload.username);
  const doc = await ref.get();
  if (!doc.exists) return res.status(404).json({ error: 'Usuario no encontrado' });

  const now = new Date().toISOString();
  const invoice = {
    name:   `Suscripción ${PLAN_LABELS[planKey] || planKey} - ${new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}`,
    date:   now,
    url:    subId ? `https://www.mercadopago.com.ar/subscriptions/manage/${subId}` : `https://www.mercadopago.com.ar/suscripciones`,
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
