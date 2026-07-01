import { db } from './_lib/firebase.js';
import { requireAuth } from './_lib/auth.js';

const PLAN_IDS = {
  starter:          '4f3cbb4d7b7643ccac2f4c5d06353e2c',
  pro:              '8249ed9006064842b67ece3d76b38e0a',
  business:         '472deed04ef0404682fd78048a5324e0',
  premium:          '55add3001b744fbab79927fe89c1c28f',
  'starter-anual':  '6cb2fc66d5354ac5a771ca0244f290b5',
  'pro-anual':      '6e1a6a2e820c492fae62a60cbee873d6',
  'business-anual': '83c5dfb9f53142d782295066589ac3be',
  'premium-anual':  '8684980e1e9444f1aa051314f9e57b4d'
};

const PLAN_LABELS = {
  starter:'Starter', pro:'Pro', business:'Business', premium:'Premium',
  'starter-anual':'Starter Anual', 'pro-anual':'Pro Anual',
  'business-anual':'Business Anual', 'premium-anual':'Premium Anual'
};
const PLAN_PRICES = {
  starter:'$2.000', pro:'$3.000', business:'$4.500', premium:'$10.500',
  'starter-anual':'$24.000', 'pro-anual':'$36.000',
  'business-anual':'$43.200', 'premium-anual':'$126.000'
};

// Mapeo de plan anual → plan base (para activar el plan correcto en Firestore)
const ANNUAL_TO_BASE = {
  'starter-anual':'starter', 'pro-anual':'pro',
  'business-anual':'business', 'premium-anual':'premium'
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://etify.com.ar');
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
  const auth  = { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } };
  let planKey = user.mpPendingPlan;
  let subId   = null;

  if (planKey && PLAN_IDS[planKey]) {
    // Flujo normal: hay plan pendiente → buscar en ese plan específico
    const planId = PLAN_IDS[planKey];
    const since  = user.mpPendingPlanAt ? new Date(user.mpPendingPlanAt) : new Date(Date.now() - 24 * 60 * 60 * 1000);

    // 1. Buscar por external_reference + plan
    try {
      const r = await fetch(`https://api.mercadopago.com/preapproval/search?external_reference=${encodeURIComponent(username)}&preapproval_plan_id=${planId}&status=authorized&limit=1`, auth);
      const d = await r.json();
      subId = d.results?.[0]?.id || null;
    } catch (_) {}

    // 2. Buscar por email + plan
    if (!subId && user.email) {
      try {
        const r = await fetch(`https://api.mercadopago.com/preapproval/search?payer_email=${encodeURIComponent(user.email)}&preapproval_plan_id=${planId}&status=authorized&limit=1`, auth);
        const d = await r.json();
        subId = d.results?.[0]?.id || null;
      } catch (_) {}
    }

    // 3. Buscar en el plan sin filtrar por usuario, validando ownership
    if (!subId) {
      try {
        const r = await fetch(`https://api.mercadopago.com/preapproval/search?preapproval_plan_id=${planId}&status=authorized&limit=20`, auth);
        const d = await r.json();
        const match = (d.results || []).find(s => {
          if (new Date(s.date_created) < since) return false;
          if (s.external_reference === username) return true;
          const subEmail = s.payer_email || s.payer?.email;
          return subEmail && user.email && subEmail.toLowerCase() === user.email.toLowerCase();
        });
        subId = match?.id || null;
      } catch (_) {}
    }
  } else {
    // Sin mpPendingPlan: buscar en TODOS los planes por external_reference o email
    // Cubre el caso donde el usuario pagó sin pasar por la pasarela o volvió manualmente
    const allPlanIds = Object.values(PLAN_IDS);
    for (const pid of allPlanIds) {
      if (subId) break;
      try {
        const r = await fetch(`https://api.mercadopago.com/preapproval/search?external_reference=${encodeURIComponent(username)}&preapproval_plan_id=${pid}&status=authorized&limit=1`, auth);
        const d = await r.json();
        if (d.results?.[0]) {
          subId   = d.results[0].id;
          // Determinar qué planKey corresponde a este plan ID
          planKey = Object.keys(PLAN_IDS).find(k => PLAN_IDS[k] === pid) || null;
        }
      } catch (_) {}
    }
    // Si no encontró por external_reference, buscar por email
    if (!subId && user.email) {
      for (const pid of allPlanIds) {
        if (subId) break;
        try {
          const r = await fetch(`https://api.mercadopago.com/preapproval/search?payer_email=${encodeURIComponent(user.email)}&preapproval_plan_id=${pid}&status=authorized&limit=1`, auth);
          const d = await r.json();
          if (d.results?.[0]) {
            subId   = d.results[0].id;
            planKey = Object.keys(PLAN_IDS).find(k => PLAN_IDS[k] === pid) || null;
          }
        } catch (_) {}
      }
    }
    if (!subId) return res.json({ status: 'none' });
  }

  if (!subId) return res.json({ status: 'not_found' });

  // Para planes anuales, el plan que se activa en Firestore es el plan base
  const basePlanKey = ANNUAL_TO_BASE[planKey] || planKey;
  const isAnnual    = !!ANNUAL_TO_BASE[planKey];

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
    plan:            basePlanKey,
    active:          true,
    mpSubId:         subId,
    mpPendingPlan:   null,
    mpPendingPlanAt: null,
    ...(isAnnual ? { billing: 'annual' } : {}),
    invoices:        [invoice, ...(user.invoices || [])].slice(0, 50),
    notifications:   [notif,   ...(user.notifications || [])].slice(0, 50)
  });

  res.json({ status: 'activated', planKey: basePlanKey });
}
