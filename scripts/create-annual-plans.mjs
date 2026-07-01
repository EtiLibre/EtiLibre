/**
 * Script one-time: crea los 4 planes anuales en MercadoPago y muestra los IDs.
 * Uso: node scripts/create-annual-plans.mjs TU_MP_ACCESS_TOKEN
 */

const token = process.argv[2];
if (!token) {
  console.error('Uso: node scripts/create-annual-plans.mjs TU_MP_ACCESS_TOKEN');
  process.exit(1);
}

const plans = [
  { key: 'starter',  label: 'Etify Starter Anual',  amount: 24000 },
  { key: 'pro',      label: 'Etify Pro Anual',       amount: 36000 },
  { key: 'business', label: 'Etify Business Anual',  amount: 43200 },
  { key: 'premium',  label: 'Etify Premium Anual',   amount: 126000 },
];

for (const plan of plans) {
  const res = await fetch('https://api.mercadopago.com/preapproval_plan', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      reason:              plan.label,
      auto_recurring: {
        frequency:       12,
        frequency_type:  'months',
        transaction_amount: plan.amount,
        currency_id:     'ARS'
      },
      back_url: 'https://etify.com.ar',
      payment_methods_allowed: {
        payment_types:  [{ id: 'credit_card' }, { id: 'debit_card' }],
        payment_methods: []
      }
    })
  });
  const data = await res.json();
  if (res.ok && data.id) {
    console.log(`✅ ${plan.key}: ${data.id}`);
  } else {
    console.error(`❌ ${plan.key}: ${JSON.stringify(data)}`);
  }
}
