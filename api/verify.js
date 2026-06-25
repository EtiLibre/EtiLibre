const PLAN_IDS = {
  starter:  '58467cb629d74197865cbc946f055002',
  pro:      'f27759d82eac49ec8c1cfeef3964b94f',
  business: '6704b497950d4634817905965b5a09a3',
  premium:  '06d73d81f8a44a1aab3052eb1355e78c'
};

const PLAN_MAP = Object.fromEntries(Object.entries(PLAN_IDS).map(([k,v]) => [v,k]));

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const { email, planKey } = req.query;
  if (!email || !planKey) return res.status(400).json({ error: 'Faltan parámetros' });

  const planId = PLAN_IDS[planKey?.toLowerCase()];
  if (!planId) return res.status(400).json({ error: 'Plan inválido' });

  try {
    // Buscar suscripción autorizada
    const r = await fetch(
      `https://api.mercadopago.com/preapproval/search?payer_email=${encodeURIComponent(email)}&preapproval_plan_id=${planId}&status=authorized&limit=1`,
      { headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` } }
    );
    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: data });

    const results = data.results || [];
    if (results.length > 0) {
      const sub = results[0];
      return res.json({ status: 'authorized', plan: PLAN_MAP[sub.preapproval_plan_id] || planKey, subId: sub.id });
    }

    // Si no hay autorizada, buscar cualquier estado
    const r2 = await fetch(
      `https://api.mercadopago.com/preapproval/search?payer_email=${encodeURIComponent(email)}&preapproval_plan_id=${planId}&limit=1`,
      { headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` } }
    );
    const data2 = await r2.json();
    const sub2 = (data2.results || [])[0];
    res.json({ status: sub2?.status || 'not_found', plan: planKey, subId: sub2?.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
