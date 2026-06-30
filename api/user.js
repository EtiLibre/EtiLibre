import { db }             from './_lib/firebase.js';
import { FieldValue }     from 'firebase-admin/firestore';
import { requireAuth }    from './_lib/auth.js';
import bcrypt             from 'bcryptjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://etify.com.ar');
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
      if (!title || !body) return res.status(400).json({ error: 'Faltan datos' });
      const notif = { id:Date.now().toString(), icon:String(icon||'').slice(0,10), title:String(title).slice(0,200), body:String(body).slice(0,500), date:new Date().toISOString(), read:false };
      const doc = await ref.get();
      const list = [notif, ...(doc.data()?.notifications||[])].slice(0,50);
      await ref.update({ notifications: list });
      return res.json({ ok:true });
    }
    if (action === 'add-history') {
      // Solo permitir campos conocidos para evitar inyección de campos arbitrarios en Firestore
      const { labels, count, date, name, pages } = req.body;
      const entry = { date: date || new Date().toISOString() };
      if (labels !== undefined) entry.labels = Number(labels) || 0;
      if (count  !== undefined) entry.count  = Number(count)  || 0;
      if (pages  !== undefined) entry.pages  = Number(pages)  || 0;
      if (name   !== undefined) entry.name   = String(name).slice(0, 200);
      const doc = await ref.get();
      const list = [entry, ...(doc.data()?.history||[])].slice(0,100);
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
      const updates = {};
      if (req.body.displayName !== undefined) updates.displayName = String(req.body.displayName).slice(0, 60);
      if (req.body.avatar      !== undefined) updates.avatar      = String(req.body.avatar).slice(0, 10);
      if (req.body.nameColor   !== undefined) updates.nameColor   = /^#[0-9a-fA-F]{3,6}$/.test(req.body.nameColor) ? req.body.nameColor : '';
      if (req.body.tosAccepted !== undefined) updates.tosAccepted = Boolean(req.body.tosAccepted);
      if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Sin campos válidos' });
      await ref.update(updates);
      return res.json({ ok:true });
    }
    if (action === 'increment-usage') {
      const count = Math.max(1, Math.min(100, parseInt(req.body.count) || 1)); // entre 1 y 100
      const now = new Date();
      const curMonth = now.getFullYear() * 100 + now.getMonth();
      const doc = await ref.get();
      const d = doc.data();
      if (d.resetMonth !== curMonth) {
        await ref.update({ used: count, resetMonth: curMonth, adExtensions: 0 });
        return res.json({ ok:true, used: count });
      }
      await ref.update({ used: FieldValue.increment(count) });
      const updated = await ref.get();
      return res.json({ ok:true, used: updated.data().used });
    }
    if (action === 'watch-ad') {
      // Usar transacción para evitar race condition
      const newExts = await db.runTransaction(async tx => {
        const doc = await tx.get(ref);
        const d = doc.data();
        const now = new Date();
        const curMonth = now.getFullYear() * 100 + now.getMonth();
        const adExts = d.resetMonth !== curMonth ? 0 : (d.adExtensions || 0);
        if (adExts >= 2) throw new Error('LIMIT');
        tx.update(ref, { adExtensions: adExts + 1 });
        return adExts + 1;
      }).catch(e => { if (e.message === 'LIMIT') return null; throw e; });
      if (newExts === null) return res.status(400).json({ error: 'Límite de anuncios alcanzado' });
      return res.json({ ok:true, adExtensions: newExts });
    }
    if (action === 'help-activate') {
      const VALID_PLANS = ['starter','pro','business','premium'];
      const { planKey } = req.body;
      if (!VALID_PLANS.includes(planKey)) return res.status(400).json({ error: 'Plan inválido' });
      await ref.update({
        mpPendingPlan:   planKey,
        mpPendingPlanAt: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()
      });
      return res.json({ ok: true });
    }
    if (action === 'cancel-plan') {
      await ref.update({ plan: 'free', active: true });
      return res.json({ ok:true });
    }
    if (action === 'set-plan') {
      const VALID = ['starter','pro','business','premium'];
      const { planKey } = req.body;
      if (!VALID.includes(planKey)) return res.status(400).json({ error: 'Plan inválido' });
      // Solo marcamos el plan y active=false; mpPendingPlan se setea en /api/subscribe cuando el usuario realmente paga
      await ref.update({ plan: planKey, active: false, mpPendingPlan: null });
      return res.json({ ok:true });
    }
    if (action === 'change-password') {
      if (payload.username === 'admin') return res.status(403).end();
      const { oldPass, newPass } = req.body;
      if (!newPass || newPass.length < 8) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
      const doc = await ref.get();
      const ud = doc.data();
      // Usuarios de Google pueden crear contraseña sin verificar la actual
      if (!ud.googleAuth) {
        if (!oldPass) return res.status(400).json({ error: 'Ingresá tu contraseña actual.' });
        if (!await bcrypt.compare(oldPass, ud.pass))
          return res.status(401).json({ error: 'La contraseña actual es incorrecta.' });
      }
      await ref.update({ pass: await bcrypt.hash(newPass, 12), googleAuth: false });
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: 'Acción inválida' });
  }

  res.status(405).end();
}
