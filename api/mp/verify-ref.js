import { db } from '../_lib/firebase.js';

const PLAN_LABELS = { starter:'Starter', pro:'Pro', business:'Business', premium:'Premium' };
const PLAN_PRICES = { starter:'$2.000', pro:'$3.000', business:'$4.500', premium:'$10.500' };

const PLAN_IDS = {
  starter:  '4f3cbb4d7b7643ccac2f4c5d06353e2c',
  pro:      '8249ed9006064842b67ece3d76b38e0a',
  business: '472deed04ef0404682fd78048a5324e0',
  premium:  '55add3001b744fbab79927fe89c1c28f'
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token requerido' });

  // Buscar el token en Firestore
  const tokenDoc = await db.collection('mp_tokens').doc(token).get();
  if (!tokenDoc.exists) return res.status(404).json({ error: 'Token inválido' });

  const { username, planKey, expiresAt } = tokenDoc.data();
  if (new Date() > new Date(expiresAt)) return res.status(410).json({ error: 'Token expirado' });

  const planId = PLAN_IDS[planKey];
  if (!planId) return res.status(400).json({ error: 'Plan inválido' });

  // Verificar que el pago esté autorizado en MP buscando por external_reference o por el plan
  let subId = null;
  try {
    // Buscar suscripción activa con external_reference = username
    const r = await fetch(
      `https://api.mercadopago.com/preapproval/search?external_reference=${encodeURIComponent(username)}&preapproval_plan_id=${planId}&status=authorized&limit=1`,
      { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } }
    );
    const d = await r.json();
    subId = d.results?.[0]?.id || null;

    // Si no hay external_reference, buscar por plan reciente (creado en las últimas 2 horas)
    if (!subId) {
      const r2 = await fetch(
        `https://api.mercadopago.com/preapproval/search?preapproval_plan_id=${planId}&status=authorized&limit=10`,
        { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } }
      );
      const d2 = await r2.json();
      const tokenCreatedAt = new Date(tokenDoc.data().createdAt);
      const recent = (d2.results || []).find(s => new Date(s.date_created) >= tokenCreatedAt);
      subId = recent?.id || null;
    }
  } catch (_) {}

  if (!subId) return res.json({ status: 'pending' });

  // Activar el plan en Firestore
  const ref = db.collection('users').doc(username);
  const doc = await ref.get();
  if (!doc.exists) return res.status(404).json({ error: 'Usuario no encontrado' });

  const now     = new Date().toISOString();
  const invoice = {
    name:   `Suscripción ${PLAN_LABELS[planKey]} - ${new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}`,
    date:   now,
    url:    `https://www.mercadopago.com.ar/suscripciones`,
    amount: PLAN_PRICES[planKey],
    source: 'mercadopago'
  };
  const prev  = doc.data();
  const notif = {
    id: Date.now().toString(), icon: '✅',
    title: '¡Plan activado!',
    body:  `Tu plan ${PLAN_LABELS[planKey]} fue activado correctamente. ¡Ya podés usarlo!`,
    date:  now, read: false
  };

  await ref.update({
    plan:           planKey,
    active:         true,
    mpSubId:        subId,
    mpPendingPlan:  null,
    invoices:       [invoice, ...(prev.invoices || [])].slice(0, 50),
    notifications:  [notif,   ...(prev.notifications || [])].slice(0, 50)
  });

  // Eliminar token usado
  await db.collection('mp_tokens').doc(token).delete();

  res.json({ status: 'activated', username, planKey });
}
