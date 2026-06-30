import { db }          from './_lib/firebase.js';
import { requireAuth } from './_lib/auth.js';
import { rateLimit, getIp } from './_lib/rateLimit.js';

const PLAN_IDS = {
  starter:  '4f3cbb4d7b7643ccac2f4c5d06353e2c',
  pro:      '8249ed9006064842b67ece3d76b38e0a',
  business: '472deed04ef0404682fd78048a5324e0',
  premium:  '55add3001b744fbab79927fe89c1c28f'
};

const PLAN_MAP = Object.fromEntries(Object.entries(PLAN_IDS).map(([k,v]) => [v,k]));

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method !== 'GET') return res.status(405).end();

  const payload = requireAuth(req, res);
  if (!payload) return;

  const ip = getIp(req);
  const rl = await rateLimit(`verify:${ip}`, 20, 10 * 60 * 1000); // 20 verificaciones / 10 min
  if (!rl.allowed) return res.status(429).json({ error: 'Demasiados intentos. Esperá unos minutos.' });

  const { planKey } = req.query;
  const username = payload.username;
  if (!planKey) return res.status(400).json({ error: 'Faltan parámetros' });
  // Obtener el email real del usuario desde Firestore (no confiar en query param)
  const userDoc = await db.collection('users').doc(username).get();
  const email   = userDoc.exists ? userDoc.data().email : null;

  const planId = PLAN_IDS[planKey?.toLowerCase()];
  if (!planId) return res.status(400).json({ error: 'Plan inválido' });

  const auth = { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } };

  try {
    // 1. Buscar por external_reference (username) — más confiable, independiente del email
    if (username) {
      const r = await fetch(
        `https://api.mercadopago.com/preapproval/search?external_reference=${encodeURIComponent(username)}&preapproval_plan_id=${planId}&status=authorized&limit=1`,
        auth
      );
      const d = await r.json();
      if (d.results?.length > 0) {
        const sub = d.results[0];
        return res.json({ status: 'authorized', plan: PLAN_MAP[sub.preapproval_plan_id] || planKey, subId: sub.id });
      }
    }

    // 2. Buscar por email del pagador
    if (email) {
      const r = await fetch(
        `https://api.mercadopago.com/preapproval/search?payer_email=${encodeURIComponent(email)}&preapproval_plan_id=${planId}&status=authorized&limit=1`,
        auth
      );
      const d = await r.json();
      if (d.results?.length > 0) {
        const sub = d.results[0];
        return res.json({ status: 'authorized', plan: PLAN_MAP[sub.preapproval_plan_id] || planKey, subId: sub.id });
      }
    }

    // 3. Buscar suscripciones recientes del plan — solo las que pertenezcan al usuario (por external_reference o email)
    if (username) {
      const r = await fetch(
        `https://api.mercadopago.com/preapproval/search?preapproval_plan_id=${planId}&status=authorized&limit=10`,
        auth
      );
      const d = await r.json();
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const recent = (d.results || []).find(s => {
        if (new Date(s.date_created) < twoHoursAgo) return false;
        if (s.external_reference === username) return true;
        const subEmail = s.payer_email || s.payer?.email;
        return email && subEmail && subEmail.toLowerCase() === email.toLowerCase();
      });
      if (recent) {
        return res.json({ status: 'authorized', plan: PLAN_MAP[recent.preapproval_plan_id] || planKey, subId: recent.id });
      }
    }

    res.json({ status: 'not_found' });
  } catch (e) {
    console.error('verify error:', e.message);
    res.status(500).json({ error: 'Error interno al verificar suscripción' });
  }
}
