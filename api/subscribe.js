import { db } from './_lib/firebase.js';
import { requireAuth } from './_lib/auth.js';
import { randomBytes } from 'crypto';

const PLAN_IDS = {
  starter:         '4f3cbb4d7b7643ccac2f4c5d06353e2c',
  pro:             '8249ed9006064842b67ece3d76b38e0a',
  business:        '472deed04ef0404682fd78048a5324e0',
  premium:         '55add3001b744fbab79927fe89c1c28f',
  // Planes anuales
  'starter-anual':  '6cb2fc66d5354ac5a771ca0244f290b5',
  'pro-anual':      '6e1a6a2e820c492fae62a60cbee873d6',
  'business-anual': '83c5dfb9f53142d782295066589ac3be',
  'premium-anual':  '8684980e1e9444f1aa051314f9e57b4d'
};

const PLAN_CHECKOUT = {
  starter:         'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=4f3cbb4d7b7643ccac2f4c5d06353e2c',
  pro:             'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=8249ed9006064842b67ece3d76b38e0a',
  business:        'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=472deed04ef0404682fd78048a5324e0',
  premium:         'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=55add3001b744fbab79927fe89c1c28f',
  'starter-anual':  'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=6cb2fc66d5354ac5a771ca0244f290b5',
  'pro-anual':      'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=6e1a6a2e820c492fae62a60cbee873d6',
  'business-anual': 'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=83c5dfb9f53142d782295066589ac3be',
  'premium-anual':  'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=8684980e1e9444f1aa051314f9e57b4d'
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://etify.com.ar');
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

  // Obtener datos del usuario
  const userDoc = await db.collection('users').doc(username).get();
  if (!userDoc.exists) return res.status(404).json({ error: 'Usuario no encontrado' });
  const userEmail = userDoc.data().email;

  // Verificar si ya tiene suscripción activa (evitar duplicados)
  try {
    const searchRes = await fetch(
      `https://api.mercadopago.com/preapproval/search?preapproval_plan_id=${planId}&status=authorized&limit=50`,
      { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } }
    );
    const searchData = await searchRes.json();
    const existing = (searchData.results || []).find(s => s.external_reference === username && s.status === 'authorized');
    if (existing) {
      await db.collection('users').doc(username).update({ plan: planKey, active: true, mpSubId: existing.id, mpPendingPlan: null });
      return res.json({ already_active: true });
    }
  } catch (_) {}

  // Generar token único para identificar al usuario al volver de MP
  // Funciona sin importar con qué email de MP paguen
  const token   = randomBytes(20).toString('hex');
  const backUrl = `https://etify.com.ar?mp_ref=${token}`;

  // Guardar token en Firestore (expira en 2 horas)
  const now = new Date().toISOString();
  await db.collection('mp_tokens').doc(token).set({
    username,
    planKey,
    createdAt: now,
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  });
  await db.collection('users').doc(username).update({ mpPendingPlan: planKey, mpPendingPlanAt: now });

  // Intentar crear preapproval via API con external_reference
  try {
    const mpRes = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preapproval_plan_id: planId,
        external_reference:  username,
        payer_email:         userEmail,
        back_url:            backUrl
      })
    });
    const mpData = await mpRes.json();
    if (mpRes.ok && mpData.init_point) {
      return res.json({ init_point: mpData.init_point });
    }
  } catch (_) {}

  // Fallback: URL directa (el token en back_url igual funciona para identificar al usuario al volver)
  const fallbackUrl = PLAN_CHECKOUT[planKey] + `&back_url=${encodeURIComponent(backUrl)}`;
  res.json({ init_point: fallbackUrl });
}
