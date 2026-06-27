import { db } from './_lib/firebase.js';
import { requireAuth } from './_lib/auth.js';

const PLAN_CHECKOUT = {
  starter:  'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=4f3cbb4d7b7643ccac2f4c5d06353e2c',
  pro:      'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=8249ed9006064842b67ece3d76b38e0a',
  business: 'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=472deed04ef0404682fd78048a5324e0',
  premium:  'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=55add3001b744fbab79927fe89c1c28f'
};

const PLAN_IDS = {
  starter:  '4f3cbb4d7b7643ccac2f4c5d06353e2c',
  pro:      '8249ed9006064842b67ece3d76b38e0a',
  business: '472deed04ef0404682fd78048a5324e0',
  premium:  '55add3001b744fbab79927fe89c1c28f'
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const payload = requireAuth(req, res);
  if (!payload) return;

  const { planKey } = req.body;
  const planId      = PLAN_IDS[planKey?.toLowerCase()];
  const checkoutUrl = PLAN_CHECKOUT[planKey?.toLowerCase()];
  if (!planId || !checkoutUrl) return res.status(400).json({ error: 'Plan inválido' });

  const username = payload.username;

  try {
    // Verificar si ya tiene suscripción activa para este plan (evitar duplicados)
    const searchRes = await fetch(
      `https://api.mercadopago.com/preapproval/search?preapproval_plan_id=${planId}&status=authorized&limit=50`,
      { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } }
    );
    const searchData = await searchRes.json();
    const existing = (searchData.results || []).find(s => s.external_reference === username);
    if (existing) {
      await db.collection('users').doc(username).update({ plan: planKey, active: true, mpSubId: existing.id, mpPendingPlan: null });
      return res.json({ already_active: true });
    }

    // Guardar plan pendiente en Firestore (persiste aunque cambie de navegador en mobile)
    await db.collection('users').doc(username).update({ mpPendingPlan: planKey });

    res.json({ init_point: checkoutUrl });
  } catch (e) {
    // Si falla la búsqueda en MP igual dejamos pagar
    try { await db.collection('users').doc(username).update({ mpPendingPlan: planKey }); } catch(_) {}
    res.json({ init_point: checkoutUrl });
  }
}
