const PLAN_CHECKOUT = {
  starter:  'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=58467cb629d74197865cbc946f055002',
  pro:      'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=f27759d82eac49ec8c1cfeef3964b94f',
  business: 'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=6704b497950d4634817905965b5a09a3',
  premium:  'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=06d73d81f8a44a1aab3052eb1355e78c'
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
