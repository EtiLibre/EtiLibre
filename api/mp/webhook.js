import { db }         from '../_lib/firebase.js';
import { createHmac } from 'crypto';

function verifyWebhookSignature(req) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return false; // si no está configurado, rechazar siempre
  const xSignature  = req.headers['x-signature'];
  const xRequestId  = req.headers['x-request-id'];
  if (!xSignature) return false;
  // formato: "ts=<timestamp>,v1=<hash>"
  const parts = Object.fromEntries(xSignature.split(',').map(p => p.split('=')));
  const ts  = parts['ts'];
  const v1  = parts['v1'];
  if (!ts || !v1) return false;
  const dataId  = req.body?.data?.id || '';
  const manifest = `id:${dataId};request-date:${ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest('hex');
  return expected === v1;
}

const PLAN_MAP = {
  '4f3cbb4d7b7643ccac2f4c5d06353e2c': 'starter',
  '8249ed9006064842b67ece3d76b38e0a': 'pro',
  '472deed04ef0404682fd78048a5324e0': 'business',
  '55add3001b744fbab79927fe89c1c28f': 'premium'
};

const PLAN_LABELS = { starter:'Starter', pro:'Pro', business:'Business', premium:'Premium' };
const PLAN_PRICES = { starter:'$2.000', pro:'$3.000', business:'$4.500', premium:'$10.500' };

async function resolveUsername(sub) {
  if (sub.external_reference) return sub.external_reference;
  const email = sub.payer_email || sub.payer?.email;
  if (email) {
    const snap = await db.collection('users').where('email', '==', email).limit(1).get();
    if (!snap.empty) return snap.docs[0].id;
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!verifyWebhookSignature(req)) return res.status(401).end();

  try {
    const { type, data } = req.body;

    // ── Cobro mensual recurrente ──────────────────────────────────
    if (type === 'subscription_authorized_payment' && data?.id) {
      const pmtRes = await fetch(`https://api.mercadopago.com/authorized_payments/${data.id}`, {
        headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
      });
      const pmt = await pmtRes.json();

      // Obtener la suscripción para identificar plan y usuario
      const subRes = await fetch(`https://api.mercadopago.com/preapproval/${pmt.preapproval_id}`, {
        headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
      });
      const sub  = await subRes.json();
      const plan = PLAN_MAP[sub.preapproval_plan_id];
      if (!plan) return res.status(200).end();

      const username = await resolveUsername(sub);
      if (!username) return res.status(200).end();

      const ref = db.collection('users').doc(username);
      const doc = await ref.get();
      if (!doc.exists) return res.status(200).end();

      const now     = new Date(pmt.date_approved || new Date()).toISOString();
      const invoice = {
        name:   `Suscripción ${PLAN_LABELS[plan]} - ${new Date(now).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}`,
        date:   now,
        url:    `https://www.mercadopago.com.ar/activities/detail/${pmt.id}`,
        amount: PLAN_PRICES[plan],
        source: 'mercadopago'
      };
      const prev    = doc.data();
      const notif   = {
        id: Date.now().toString(), icon: '💳',
        title: 'Pago recibido',
        body:  `Se procesó el pago mensual de tu plan ${PLAN_LABELS[plan]}.`,
        date:  now, read: false
      };
      await ref.update({
        active:        true,
        invoices:      [invoice, ...(prev.invoices || [])].slice(0, 50),
        notifications: [notif,   ...(prev.notifications || [])].slice(0, 50)
      });
      return res.status(200).end();
    }

    // ── Cambio de estado de suscripción ──────────────────────────
    if (type !== 'subscription_preapproval' || !data?.id) return res.status(200).end();

    const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${data.id}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
    });
    const sub  = await mpRes.json();
    const plan = PLAN_MAP[sub.preapproval_plan_id];
    if (!plan) return res.status(200).end();

    const username = await resolveUsername(sub);
    if (!username) return res.status(200).end();

    const ref = db.collection('users').doc(username);
    const doc = await ref.get();
    if (!doc.exists) return res.status(200).end();

    const updates = { mpSubId: sub.id, mpStatus: sub.status };

    if (sub.status === 'authorized') {
      updates.plan          = plan;
      updates.active        = true;
      updates.mpPendingPlan = null;
      const now = new Date().toISOString();

      let mpPaymentId = null;
      try {
        const pr   = await fetch(`https://api.mercadopago.com/preapproval/${sub.id}/authorized_payments?limit=1`,
          { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } });
        const pd   = await pr.json();
        mpPaymentId = pd?.results?.[0]?.id || null;
      } catch {}

      const invoice = {
        name:   `Suscripción ${PLAN_LABELS[plan]} - ${new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}`,
        date:   now,
        url:    mpPaymentId
          ? `https://www.mercadopago.com.ar/activities/detail/${mpPaymentId}`
          : `https://www.mercadopago.com.ar/suscripciones`,
        amount: PLAN_PRICES[plan],
        source: 'mercadopago'
      };
      const prev = doc.data();
      updates.invoices      = [invoice, ...(prev.invoices || [])].slice(0, 50);
      updates.notifications = [{
        id: Date.now().toString(), icon: '✅',
        title: '¡Plan activado!',
        body:  `Tu plan ${PLAN_LABELS[plan]} fue activado correctamente por Mercado Pago.`,
        date:  now, read: false
      }, ...(prev.notifications || [])].slice(0, 50);

    } else if (sub.status === 'cancelled' || sub.status === 'paused') {
      const prev = doc.data();
      // Si ya tiene mpCancelAt vigente (canceló desde la plataforma), respetarlo
      const hasActivePeriod = prev.mpCancelAt && new Date(prev.mpCancelAt) > new Date();
      if (hasActivePeriod) {
        // nada — ya está configurado el período de gracia
      } else {
        // Canceló directo desde app de MP — buscar next_payment_date para período de gracia
        let cancelAt = sub.next_payment_date || null;
        if (!cancelAt) {
          // fallback: fin del mes actual
          const now = new Date();
          cancelAt = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
        }
        const cancelAtDate = new Date(cancelAt);
        if (cancelAtDate > new Date()) {
          // Aún dentro del período pagado — mantener activo hasta cancelAt
          updates.mpCancelAt = cancelAt;
          updates.mpStatus   = 'cancelled';
        } else {
          // Período ya vencido — bajar inmediatamente
          updates.active   = false;
          updates.mpCancelAt = cancelAt;
        }
      }
      updates.notifications = [{
        id: Date.now().toString(), icon: '⚠️',
        title: sub.status === 'cancelled' ? 'Suscripción cancelada' : 'Suscripción pausada',
        body:  `Tu suscripción ${PLAN_LABELS[plan]} fue ${sub.status === 'cancelled' ? 'cancelada' : 'pausada'} por Mercado Pago.`,
        date:  new Date().toISOString(), read: false
      }, ...(prev.notifications || [])].slice(0, 50);
    }

    await ref.update(updates);
    res.status(200).end();
  } catch (e) {
    console.error('Webhook error:', e);
    res.status(200).end();
  }
}
