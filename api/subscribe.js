const PLAN_CHECKOUT = {
  starter:  'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=4f3cbb4d7b7643ccac2f4c5d06353e2c',
  pro:      'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=8249ed9006064842b67ece3d76b38e0a',
  business: 'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=472deed04ef0404682fd78048a5324e0',
  premium:  'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=55add3001b744fbab79927fe89c1c28f'
};

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { planKey } = req.body;
  const url = PLAN_CHECKOUT[planKey?.toLowerCase()];
  if (!url) return res.status(400).json({ error: 'Plan inválido' });

  res.json({ init_point: url });
}
