const PLAN_IDS = {
  starter:  '4f3cbb4d7b7643ccac2f4c5d06353e2c',
  pro:      '8249ed9006064842b67ece3d76b38e0a',
  business: '472deed04ef0404682fd78048a5324e0',
  premium:  '55add3001b744fbab79927fe89c1c28f'
};

const PLAN_MAP = Object.fromEntries(Object.entries(PLAN_IDS).map(([k,v]) => [v,k]));

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const { email, planKey, username } = req.query;
  if (!planKey) return res.status(400).json({ error: 'Faltan parámetros' });

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

    // 3. Buscar cualquier suscripción autorizada reciente para ese plan (último recurso)
    if (username) {
      const r = await fetch(
        `https://api.mercadopago.com/preapproval/search?preapproval_plan_id=${planId}&status=authorized&limit=5`,
        auth
      );
      const d = await r.json();
      // Tomar la más reciente (creada en las últimas 2 horas)
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const recent = (d.results || []).find(s => new Date(s.date_created) >= twoHoursAgo);
      if (recent) {
        return res.json({ status: 'authorized', plan: PLAN_MAP[recent.preapproval_plan_id] || planKey, subId: recent.id });
      }
    }

    res.json({ status: 'not_found' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
