import { db } from '../_lib/firebase.js';

const PLAN_MAP = {
  '4f3cbb4d7b7643ccac2f4c5d06353e2c': 'starter',
  '8249ed9006064842b67ece3d76b38e0a': 'pro',
  '472deed04ef0404682fd78048a5324e0': 'business',
  '55add3001b744fbab79927fe89c1c28f': 'premium'
};

const PLAN_LABELS = { starter:'Starter', pro:'Pro', business:'Business', premium:'Premium' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { type, data } = req.body;
    if (type !== 'subscription_preapproval' || !data?.id) return res.status(200).end();

    const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${data.id}`, {
      headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` }
    });
    const sub = await mpRes.json();

    const username = sub.external_reference;
    const plan     = PLAN_MAP[sub.preapproval_plan_id];
    if (!username || !plan) return res.status(200).end();

    const ref = db.collection('users').doc(username);
    const doc = await ref.get();
    if (!doc.exists) return res.status(200).end();

    const updates = { mpSubId: sub.id, mpStatus: sub.status };

    if (sub.status === 'authorized') {
      updates.plan          = plan;
      updates.active        = true;
      updates.mpPendingPlan = null;
      const now = new Date().toISOString();
      const PLAN_PRICES = { starter: '$2.000', pro: '$3.000', business: '$4.500', premium: '$10.500' };

      // Buscar el último pago de esta suscripción para obtener el ID de comprobante
      let mpPaymentId = null;
      try {
        const paymentsRes = await fetch(
          `https://api.mercadopago.com/preapproval/${sub.id}/authorized_payments?limit=1`,
          { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } }
        );
        const paymentsData = await paymentsRes.json();
        mpPaymentId = paymentsData?.results?.[0]?.id || null;
      } catch {}

      const invoice = {
        name: `Suscripción ${PLAN_LABELS[plan]} - ${new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}`,
        date: now,
        url:  mpPaymentId
          ? `https://www.mercadopago.com.ar/activities/detail/${mpPaymentId}`
          : `https://www.mercadopago.com.ar/suscripciones`,
        amount: PLAN_PRICES[plan],
        source: 'mercadopago'
      };
      const prevInvoices = doc.data().invoices || [];
      updates.invoices = [invoice, ...prevInvoices].slice(0, 50);

      const notif = {
        id: Date.now().toString(), icon: '✅',
        title: '¡Plan activado!',
        body:  `Tu plan ${PLAN_LABELS[plan]} fue activado correctamente por Mercado Pago.`,
        date:  now, read: false
      };
      const notifs = [notif, ...(doc.data().notifications || [])].slice(0, 50);
      updates.notifications = notifs;
    } else if (sub.status === 'cancelled' || sub.status === 'paused') {
      updates.active = false;
      const notif = {
        id: Date.now().toString(), icon: '⚠️',
        title: 'Suscripción pausada',
        body:  `Tu suscripción ${PLAN_LABELS[plan]} fue ${sub.status === 'cancelled' ? 'cancelada' : 'pausada'} por Mercado Pago.`,
        date:  new Date().toISOString(), read: false
      };
      const notifs = [notif, ...(doc.data().notifications || [])].slice(0, 50);
      updates.notifications = notifs;
    }

    await ref.update(updates);
    res.status(200).end();
  } catch (e) {
    console.error('Webhook error:', e);
    res.status(200).end(); // Siempre 200 para que MP no reintente
  }
}
