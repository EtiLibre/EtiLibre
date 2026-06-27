import { db } from './_lib/firebase.js';
import { requireAuth } from './_lib/auth.js';

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
  const planId = PLAN_IDS[planKey?.toLowerCase()];
  if (!planId) return res.status(400).json({ error: 'Plan inválido' });

  const username = payload.username;

  try {
    // Buscar si ya existe una suscripción autorizada para evitar duplicados
    const searchRes = await fetch(
      `https://api.mercadopago.com/preapproval/search?external_reference=${encodeURIComponent(username)}&preapproval_plan_id=${planId}&status=authorized&limit=1`,
      { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } }
    );
    const searchData = await searchRes.json();
    const existing = searchData.results?.[0];
    if (existing) {
      // Ya tiene suscripción activa — activar directamente sin redirigir
      const ref = db.collection('users').doc(username);
      await ref.update({ plan: planKey, active: true, mpSubId: existing.id, mpPendingPlan: null });
      return res.json({ already_active: true });
    }

    // Crear nueva suscripción con external_reference para que el webhook identifique al usuario
    const mpRes = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        preapproval_plan_id: planId,
        external_reference:  username,
        back_url:            'https://etify.com.ar'
      })
    });

    const data = await mpRes.json();
    if (!mpRes.ok) return res.status(500).json({ error: data.message || 'Error MP' });

    // Guardar plan pendiente en Firestore para recuperarlo sin importar el navegador
    await db.collection('users').doc(username).update({ mpPendingPlan: planKey });

    res.json({ init_point: data.init_point });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
