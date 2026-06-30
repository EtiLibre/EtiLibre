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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const payload = requireAuth(req, res);
  if (!payload) return;

  const username = payload.username;
  const ref = db.collection('users').doc(username);
  const doc = await ref.get();
  if (!doc.exists) return res.status(404).json({ error: 'Usuario no encontrado' });

  const user = doc.data();
  const planKey = user.mpPendingPlan;
  if (!planKey) return res.json({ status: 'none' });

  const planId = PLAN_IDS[planKey];
  if (!planId) return res.json({ status: 'none' });

  const since = user.mpPendingPlanAt ? new Date(user.mpPendingPlanAt) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const auth  = { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } };

  let subId = null;

  // 1. Buscar por external_reference (si la suscripción fue creada vía API)
  try {
    const r = await fetch(
      `https://api.mercadopago.com/preapproval/search?external_reference=${encodeURIComponent(username)}&preapproval_plan_id=${planId}&status=authorized&limit=1`,
      auth
    );
    const d = await r.json();
    subId = d.results?.[0]?.id || null;
  } catch (_) {}

  // 2. Buscar por email registrado en Etify
  if (!subId && user.email) {
    try {
      const r = await fetch(
        `https://api.mercadopago.com/preapproval/search?payer_email=${encodeURIComponent(user.email)}&preapproval_plan_id=${planId}&status=authorized&limit=1`,
        auth
      );
      const d = await r.json();
      subId = d.results?.[0]?.id || null;
    } catch (_) {}
  }

  // 3. Buscar suscripciones recientes del plan, filtrando por ownership (external_reference o email del pagador)
  if (!subId) {
    try {
      const r = await fetch(
        `https://api.mercadopago.com/preapproval/search?preapproval_plan_id=${planId}&status=authorized&limit=20`,
        auth
      );
      const d = await r.json();
      const match = (d.results || []).find(s => {
        if (new Date(s.date_created) < since) return false;
        // Solo aceptar si la suscripción pertenece a este usuario
        if (s.external_reference === username) return true;
        const subEmail = s.payer_email || s.payer?.email;
        return subEmail && user.email && subEmail.toLowerCase() === user.email.toLowerCase();
      });
      subId = match?.id || null;
    } catch (_) {}
  }

  if (!subId) return res.json({ status: 'not_found' });

  // Activar plan en Firestore
  const now     = new Date().toISOString();
  const invoice = {
    name:   `Suscripción ${PLAN_LABELS[planKey]} - ${new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}`,
    date:   now,
    url:    `https://www.mercadopago.com.ar/subscriptions/manage/${subId}`,
    amount: PLAN_PRICES[planKey],
    source: 'mercadopago'
  };
  const notif = {
    id: Date.now().toString(), icon: '✅',
    title: '¡Plan activado!',
    body:  `Tu plan ${PLAN_LABELS[planKey]} fue activado correctamente. ¡Ya podés usarlo!`,
    date:  now, read: false
  };
  await ref.update({
    plan:           planKey,
    active:         true,
    mpSubId:        subId,
    mpPendingPlan:  null,
    mpPendingPlanAt: null,
    invoices:       [invoice, ...(user.invoices || [])].slice(0, 50),
    notifications:  [notif,   ...(user.notifications || [])].slice(0, 50)
  });

  res.json({ status: 'activated', planKey });
}
