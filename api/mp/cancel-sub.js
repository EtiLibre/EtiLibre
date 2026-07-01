import { db } from '../_lib/firebase.js';
import { requireAuth } from '../_lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://etify.com.ar');
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

  const ud = doc.data();
  let { mpSubId } = ud;

  // Si no hay mpSubId guardado, buscarlo en MP por email o external_reference
  if (!mpSubId && ud.plan && ud.plan !== 'free') {
    const auth = { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } };
    const PLAN_IDS = {
      starter:          '4f3cbb4d7b7643ccac2f4c5d06353e2c',
      pro:              '8249ed9006064842b67ece3d76b38e0a',
      business:         '472deed04ef0404682fd78048a5324e0',
      premium:          '55add3001b744fbab79927fe89c1c28f',
      'starter-anual':  '6cb2fc66d5354ac5a771ca0244f290b5',
      'pro-anual':      '6e1a6a2e820c492fae62a60cbee873d6',
      'business-anual': '83c5dfb9f53142d782295066589ac3be',
      'premium-anual':  '8684980e1e9444f1aa051314f9e57b4d'
    };
    // Buscar en todos los planes activos del usuario (mensual y anual)
    const planId = PLAN_IDS[ud.plan] || PLAN_IDS[ud.plan + '-anual'];
    // Buscar cualquier suscripción activa por external_reference (no importa el plan)
    try {
      const r = await fetch(`https://api.mercadopago.com/preapproval/search?external_reference=${encodeURIComponent(username)}&status=authorized&limit=5`, auth);
      const d = await r.json();
      mpSubId = d.results?.[0]?.id || null;
    } catch (_) {}
    // Buscar por email si no se encontró
    if (!mpSubId && ud.email && planId) {
      try {
        const r = await fetch(`https://api.mercadopago.com/preapproval/search?payer_email=${encodeURIComponent(ud.email)}&status=authorized&limit=5`, auth);
        const d = await r.json();
        mpSubId = d.results?.[0]?.id || null;
      } catch (_) {}
    }
  }

  // Cancelar en MercadoPago si existe suscripción y obtener fecha de fin de período
  let mpCancelled = false;
  let cancelAt    = null;

  if (mpSubId) {
    try {
      // Obtener detalles de la suscripción para saber cuándo vence el período actual
      const detail = await fetch(`https://api.mercadopago.com/preapproval/${mpSubId}`, {
        headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
      });
      const subData = await detail.json();
      // next_payment_date es cuando hubiera sido el próximo cobro = fin del período ya pago
      cancelAt = subData.next_payment_date || null;
    } catch (_) {}

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

  // Si no pudimos obtener la fecha de MP, usar fin del mes actual como fallback
  if (!cancelAt) {
    const now = new Date();
    cancelAt = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  }

  // Solo nullear mpSubId si la cancelación en MP fue exitosa
  // Si falló, conservarlo para poder reintentarlo después
  await ref.update({
    ...(mpCancelled ? { mpSubId: null } : {}),
    mpStatus:     'cancelled',
    mpCancelAt:   cancelAt,
    mpPendingPlan: null
  });

  res.json({ ok: true, mpCancelled, cancelAt });
}
