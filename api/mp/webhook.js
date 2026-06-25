import { db } from '../_lib/firebase.js';

const PLAN_MAP = {
  '58467cb629d74197865cbc946f055002': 'starter',
  'f27759d82eac49ec8c1cfeef3964b94f': 'pro',
  '6704b497950d4634817905965b5a09a3': 'business',
  '06d73d81f8a44a1aab3052eb1355e78c': 'premium'
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
      updates.plan   = plan;
      updates.active = true;
      const notif = {
        id: Date.now().toString(), icon: '✅',
        title: '¡Plan activado!',
        body:  `Tu plan ${PLAN_LABELS[plan]} fue activado correctamente por Mercado Pago.`,
        date:  new Date().toISOString(), read: false
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
