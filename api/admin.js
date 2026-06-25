import { db }           from './_lib/firebase.js';
import { requireAdmin } from './_lib/auth.js';

const PLAN_LABELS = { starter:'Starter', pro:'Pro', business:'Business', premium:'Premium' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const payload = requireAdmin(req, res);
  if (!payload) return;

  const ref = db.collection('users');

  // GET — listar todos los usuarios
  if (req.method === 'GET') {
    const snap = await ref.get();
    const users = snap.docs.map(d => { const { pass:_, ...u } = d.data(); return u; });
    return res.json(users);
  }

  // PUT — actualizar usuario
  if (req.method === 'PUT') {
    const { username, ...body } = req.body;
    if (!username) return res.status(400).json({ error: 'Falta username' });
    const allowed = ['plan','active','paymentRef','nameColor','displayName','avatar','notifications','mpSubId','mpStatus'];
    const updates = {};
    for (const k of allowed) if (body[k] !== undefined) updates[k] = body[k];
    await ref.doc(username).update(updates);
    return res.json({ ok:true });
  }

  // DELETE — eliminar usuario
  if (req.method === 'DELETE') {
    const { username } = req.body;
    if (!username || username === 'admin') return res.status(400).json({ error: 'Usuario inválido' });
    await ref.doc(username).delete();
    return res.json({ ok:true });
  }

  // POST — subir o eliminar factura
  if (req.method === 'POST') {
    const { action, username } = req.body;
    if (!username) return res.status(400).json({ error: 'Falta username' });
    const doc = await ref.doc(username).get();
    if (!doc.exists) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (action === 'add-invoice') {
      const { name, data, date } = req.body;
      if (!name || !data) return res.status(400).json({ error: 'Faltan datos' });
      const list   = [{ name, data, date: date||new Date().toISOString() }, ...(doc.data().invoices||[])];
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
