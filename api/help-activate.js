import { db } from './_lib/firebase.js';
import { requireAuth } from './_lib/auth.js';

const VALID_PLANS = ['starter','pro','business','premium'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const payload = requireAuth(req, res);
  if (!payload) return;

  const { planKey } = req.body;
  if (!VALID_PLANS.includes(planKey)) return res.status(400).json({ error: 'Plan inválido' });

  const now = new Date().toISOString();
  // Guardar plan pendiente con timestamp actual para que check-pending busque desde ahora
  // También busca suscripciones de las últimas 72 horas
  await db.collection('users').doc(payload.username).update({
    mpPendingPlan:   planKey,
    mpPendingPlanAt: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()
  });

  res.json({ ok: true });
}
