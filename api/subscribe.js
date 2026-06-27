import { db } from './_lib/firebase.js';
import { requireAuth } from './_lib/auth.js';

const PLAN_IDS = {
  starter:  '4f3cbb4d7b7643ccac2f4c5d06353e2c',
  pro:      '8249ed9006064842b67ece3d76b38e0a',
  business: '472deed04ef0404682fd78048a5324e0',
  premium:  '55add3001b744fbab79927fe89c1c28f'
};

// Fallback: URL directa sin external_reference (último recurso)
const PLAN_CHECKOUT = {
  starter:  'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=4f3cbb4d7b7643ccac2f4c5d06353e2c',
  pro:      'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=8249ed9006064842b67ece3d76b38e0a',
  business: 'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=472deed04ef0404682fd78048a5324e0',
  premium:  'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=55add3001b744fbab79927fe89c1c28f'
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
  const planId = PLAN_IDS[planKey?.toLowerCase()];
  if (!planId) return res.status(400).json({ error: 'Plan inválido' });

  const username = payload.username;

  // Obtener email del usuario desde Firestore
  const userDoc = await db.collection('users').doc(username).get();
  if (!userDoc.exists) return res.status(404).json({ error: 'Usuario no encontrado' });
  const userEmail = userDoc.data().email;

  // Verificar si ya tiene suscripción activa para evitar duplicados
  try {
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
  } catch (_) {}

  // Crear suscripción pendiente con external_reference + payer_email
  // Así el webhook identifica al usuario sin importar con qué email pague
  try {
    const mpRes = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        preapproval_plan_id: planId,
        external_reference:  username,
        payer_email:         userEmail,
        back_url:            'https://etify.com.ar'
      })
    });
    const mpData = await mpRes.json();

    if (mpRes.ok && mpData.init_point) {
      await db.collection('users').doc(username).update({ mpPendingPlan: planKey });
      return res.json({ init_point: mpData.init_point });
    }
  } catch (_) {}

  // Fallback: URL de checkout directa (sin external_reference, identificación por email)
  await db.collection('users').doc(username).update({ mpPendingPlan: planKey }).catch(() => {});
  res.json({ init_point: PLAN_CHECKOUT[planKey] });
}
