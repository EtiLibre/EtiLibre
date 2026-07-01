import { db }           from './_lib/firebase.js';
import { requireAdmin } from './_lib/auth.js';

const PLAN_LABELS = { starter:'Starter', pro:'Pro', business:'Business', premium:'Premium' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://etify.com.ar');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const payload = requireAdmin(req, res);
  if (!payload) return;

  const ref = db.collection('users');

  // GET — listar usuarios, bajas o códigos promo
  if (req.method === 'GET') {
    if (req.query.type === 'deleted') {
      const snap = await db.collection('deleted_users').get();
      const users = snap.docs.map(d => { const { pass:_, ...u } = d.data(); return u; });
      return res.json(users);
    }
    if (req.query.type === 'promos') {
      const snap = await db.collection('promo_codes').orderBy('createdAt', 'desc').get();
      return res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }
    const snap = await ref.get();
    const users = snap.docs.map(d => { const { pass:_, ...u } = d.data(); return u; });
    return res.json(users);
  }

  // PUT — actualizar usuario
  if (req.method === 'PUT') {
    const { username, ...body } = req.body;
    if (!username) return res.status(400).json({ error: 'Falta username' });
    const VALID_PLANS = ['free','starter','pro','business','premium'];
    const updates = {};
    if (body.plan        !== undefined) updates.plan        = VALID_PLANS.includes(body.plan) ? body.plan : undefined;
    if (body.active      !== undefined) updates.active      = Boolean(body.active);
    if (body.paymentRef  !== undefined) updates.paymentRef  = String(body.paymentRef).slice(0, 200);
    if (body.nameColor   !== undefined) updates.nameColor   = /^#[0-9a-fA-F]{3,6}$/.test(body.nameColor) ? body.nameColor : '';
    if (body.displayName !== undefined) updates.displayName = String(body.displayName).slice(0, 60);
    if (body.avatar      !== undefined) updates.avatar      = String(body.avatar).slice(0, 10);
    if (body.mpSubId     !== undefined) updates.mpSubId     = String(body.mpSubId).slice(0, 100);
    if (body.mpStatus    !== undefined) updates.mpStatus    = String(body.mpStatus).slice(0, 50);
    if (body.notifications !== undefined && Array.isArray(body.notifications)) {
      updates.notifications = body.notifications.slice(0, 50);
    }
    // Eliminar claves con valor undefined para no escribirlas en Firestore
    for (const k of Object.keys(updates)) if (updates[k] === undefined) delete updates[k];
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Sin campos válidos' });
    await ref.doc(username).update(updates);
    return res.json({ ok:true });
  }

  // DELETE — soft-delete: mover a deleted_users
  if (req.method === 'DELETE') {
    const { username } = req.body;
    if (!username || username === 'admin') return res.status(400).json({ error: 'Usuario inválido' });
    const doc = await ref.doc(username).get();
    if (doc.exists) {
      const { pass:_, ...ud } = doc.data();
      await db.collection('deleted_users').doc(username).set({
        ...ud,
        deletedAt: new Date().toISOString(),
        previousPlan: ud.plan || 'free',
        hadInvoice: !!(ud.invoices?.length),
        mpSubId: ud.mpSubId || null,
      });
      await ref.doc(username).delete();
    }
    return res.json({ ok:true });
  }

  // POST — facturas, notificaciones o códigos promo
  if (req.method === 'POST') {
    const { action, username } = req.body;

    // Gestión de códigos promocionales (no requieren username)
    if (action === 'create-promo') {
      const { code, plan, maxUses, durationDays } = req.body;
      if (!code || !plan || !maxUses) return res.status(400).json({ error: 'Faltan datos' });
      const VALID_PLANS = ['starter','pro','business','premium'];
      if (!VALID_PLANS.includes(plan)) return res.status(400).json({ error: 'Plan inválido' });
      const safeCode = String(code).toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 30);
      if (!safeCode) return res.status(400).json({ error: 'Código inválido' });
      const codeRef = db.collection('promo_codes').doc(safeCode);
      if ((await codeRef.get()).exists) return res.status(409).json({ error: 'El código ya existe' });
      await codeRef.set({
        plan,
        maxUses:     Math.max(1, Math.min(10000, parseInt(maxUses) || 1)),
        durationDays: Math.max(0, parseInt(durationDays) || 30),
        usedCount:   0,
        active:      true,
        createdAt:   new Date().toISOString(),
        usedBy:      []
      });
      return res.json({ ok: true, code: safeCode });
    }

    if (action === 'toggle-promo') {
      const { code, active } = req.body;
      if (!code) return res.status(400).json({ error: 'Falta código' });
      await db.collection('promo_codes').doc(String(code).toUpperCase()).update({ active: Boolean(active) });
      return res.json({ ok: true });
    }

    if (action === 'delete-promo') {
      const { code } = req.body;
      if (!code) return res.status(400).json({ error: 'Falta código' });
      await db.collection('promo_codes').doc(String(code).toUpperCase()).delete();
      return res.json({ ok: true });
    }

    if (!username) return res.status(400).json({ error: 'Falta username' });
    const doc = await ref.doc(username).get();
    if (!doc.exists) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (action === 'add-invoice') {
      const { name, data, date } = req.body;
      if (!name || !data) return res.status(400).json({ error: 'Faltan datos' });
      if (String(name).length > 200) return res.status(400).json({ error: 'Nombre demasiado largo' });
      if (String(data).length > 500000) return res.status(400).json({ error: 'Archivo demasiado grande' });
      const list   = [{ name: String(name).slice(0,200), data, date: date||new Date().toISOString() }, ...(doc.data().invoices||[])];
      const notifs = [
        { id:Date.now().toString(), icon:'🧾', title:'Nueva factura disponible',
          body:'Tu comprobante está disponible. Podés descargarlo desde la sección Comprobantes en tu perfil.',
          date:new Date().toISOString(), read:false },
        ...(doc.data().notifications||[])
      ].slice(0,50);
      await ref.doc(username).update({ invoices: list, notifications: notifs });
      return res.json({ ok:true });
    }

    if (action === 'delete-invoice') {
      const { idx } = req.body;
      if (idx === undefined) return res.status(400).json({ error: 'Falta idx' });
      const list = doc.data().invoices || [];
      list.splice(idx, 1);
      await ref.doc(username).update({ invoices: list });
      return res.json({ ok:true });
    }

    if (action === 'notify') {
      const { icon, title, body } = req.body;
      const notifs = [
        { id:Date.now().toString(), icon:icon||'📢', title, body, date:new Date().toISOString(), read:false },
        ...(doc.data().notifications||[])
      ].slice(0,50);
      await ref.doc(username).update({ notifications: notifs });
      return res.json({ ok:true });
    }

    return res.status(400).json({ error: 'Acción inválida' });
  }

  res.status(405).end();
}
