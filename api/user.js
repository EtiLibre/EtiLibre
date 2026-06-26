import { db }          from './_lib/firebase.js';
import { requireAuth } from './_lib/auth.js';
import bcrypt          from 'bcryptjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const payload = requireAuth(req, res);
  if (!payload) return;
  const ref = db.collection('users').doc(payload.username);

  // GET — notificaciones o historial
  if (req.method === 'GET') {
    const doc = await ref.get();
    const { type } = req.query;
    if (type === 'history')       return res.json(doc.data()?.history || []);
    if (type === 'notifications') return res.json(doc.data()?.notifications || []);
    return res.status(400).json({ error: 'Falta type' });
  }

  // POST — add notification | add history | mark-read
  if (req.method === 'POST') {
    const { action } = req.body;
    if (action === 'add-notification') {
      const { icon, title, body } = req.body;
      const notif = { id:Date.now().toString(), icon, title, body, date:new Date().toISOString(), read:false };
      const doc = await ref.get();
      const list = [notif, ...(doc.data()?.notifications||[])].slice(0,50);
      await ref.update({ notifications: list });
      return res.json({ ok:true });
    }
    if (action === 'add-history') {
      const { pdfData:_, ...meta } = req.body;
      const doc = await ref.get();
      const list = [{ ...meta, date: meta.date||new Date().toISOString() }, ...(doc.data()?.history||[])].slice(0,100);
      await ref.update({ history: list });
      return res.json({ ok:true });
    }
    if (action === 'mark-read') {
      const doc = await ref.get();
      const list = (doc.data()?.notifications||[]).map(n=>({...n,read:true}));
      await ref.update({ notifications: list });
      return res.json({ ok:true });
    }
    return res.status(400).json({ error: 'Acción inválida' });
  }

  // PUT — update profile | change-password
  if (req.method === 'PUT') {
    const { action } = req.body;
    if (action === 'update') {
      const allowed = ['displayName','avatar','nameColor','tosAccepted'];
      const updates = {};
      for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
      await ref.update(updates);
      return res.json({ ok:true });
    }
    if (action === 'increment-usage') {
      const { count } = req.body;
      const doc = await ref.get();
      const d = doc.data();
      const now = new Date();
      const curMonth = now.getFullYear() * 100 + now.getMonth();
      const used = d.resetMonth !== curMonth ? (count||1) : (d.used||0) + (count||1);
      await ref.update({ used, resetMonth: curMonth });
      return res.json({ ok:true, used });
    }
    if (action === 'change-password') {
      if (payload.username === 'admin') return res.status(403).end();
      const { oldPass, newPass } = req.body;
      if (!oldPass || !newPass || newPass.length < 8) return res.status(400).json({ error: 'Datos inválidos' });
      const doc = await ref.get();
      if (!await bcrypt.compare(oldPass, doc.data().pass))
        return res.status(401).json({ error: 'La contraseña actual es incorrecta.' });
      await ref.update({ pass: await bcrypt.hash(newPass, 12) });
      return res.json({ ok:true });
    }
    return res.status(400).json({ error: 'Acción inválida' });
  }

  res.status(405).end();
}
