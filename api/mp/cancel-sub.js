import { db } from '../_lib/firebase.js';
import { requireAuth } from '../_lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const payload = requireAuth(req, res);
  if (!payload) return;

  const username = payload.username;
  const ref = db.collection('users').doc(username);
  const doc = await ref.get();
  if (!doc.exists) return res.status(404).json({ error: 'Usuario no encontrado' });

  const { mpSubId } = doc.data();

  // Cancelar en MercadoPago si existe suscripción
  let mpCancelled = false;
  if (mpSubId) {
    try {
      const r = await fetch(`https://api.mercadopago.com/preapproval/${mpSubId}`, {
        method: 'PUT',
        headers: {
          Authorization:  `Bearer ${process.env.MP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: 'cancelled' })
      });
      mpCancelled = r.ok;
    } catch (_) {}
  }

  // Actualizar Firestore
  await ref.update({
    plan:      'free',
    active:    true,
    mpSubId:   null,
    mpStatus:  'cancelled',
    mpPendingPlan: null
  });

  res.json({ ok: true, mpCancelled });
}
