import { db }          from './_lib/firebase.js';
import { signToken, requireAuth } from './_lib/auth.js';
import bcrypt          from 'bcryptjs';
import { randomBytes } from 'crypto';

import { sendVerificationEmail } from './email-verify.js';

const ADMIN_HASH = process.env.ADMIN_PASS_HASH;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET /api/auth — devuelve usuario actual (me)
  if (req.method === 'GET') {
    const payload = requireAuth(req, res);
    if (!payload) return;
    if (payload.username === 'admin') {
      return res.json({ username:'admin', role:'admin', displayName:'Administrador', avatar:'⚙️', nameColor:'#FFE600', plan:'admin', active:true });
    }
    const doc = await db.collection('users').doc(payload.username).get();
    if (!doc.exists) return res.status(404).json({ error: 'Usuario no encontrado' });
    const { pass:_, ...safe } = doc.data();
    return res.json({ googleAuth: false, ...safe }); // googleAuth:false por defecto para usuarios de form
  }

  if (req.method !== 'POST') return res.status(405).end();
  const { action } = req.body;

  // POST /api/auth  action=login
  if (action === 'login') {
    const { user, pass } = req.body;
    if (!user || !pass) return res.status(400).json({ error: 'Faltan datos' });
    if (user === 'admin' || user === 'admin@etilibre.com') {
      const ok = await bcrypt.compare(pass, ADMIN_HASH);
      if (!ok) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
      const token = signToken({ username:'admin', role:'admin' });
      return res.json({ token, user:{ username:'admin', role:'admin', displayName:'Administrador', avatar:'⚙️', nameColor:'#FFE600', plan:'admin', active:true } });
    }
    let snap = await db.collection('users').where('username','==',user).limit(1).get();
    if (snap.empty) snap = await db.collection('users').where('email','==',user).limit(1).get();
    if (snap.empty) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    const doc = snap.docs[0]; const ud = doc.data();
    if (!await bcrypt.compare(pass, ud.pass)) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    const token = signToken({ username: ud.username, role:'user' });
    const { pass:_, ...safe } = ud;
    return res.json({ token, user: { googleAuth: false, ...safe } });
  }

  // POST /api/auth  action=register
  if (action === 'register') {
    const { username, email, pass, plan } = req.body;
    if (!username || !email || !pass || !plan) return res.status(400).json({ error: 'Faltan datos' });
    if (username === 'admin') return res.status(400).json({ error: 'Ese nombre de usuario ya está en uso.' });
    if (!(await db.collection('users').where('username','==',username).limit(1).get()).empty)
      return res.status(400).json({ error: 'Ese nombre de usuario ya está en uso.' });
    if (!(await db.collection('users').where('email','==',email).limit(1).get()).empty)
      return res.status(400).json({ error: 'Ese email ya está registrado.' });
    const now = new Date();
    const curMonth = now.getFullYear() * 100 + now.getMonth();

    // Verificar si el email tuvo cuenta eliminada anteriormente para heredar uso del mes
    let inheritedUsed = 0;
    const deletedSnap = await db.collection('deleted_users').where('email', '==', email).limit(1).get();
    if (!deletedSnap.empty) {
      const prev = deletedSnap.docs[0].data();
      // Si la cuenta eliminada era del mismo mes, heredar los usos gastados
      if (prev.resetMonth === curMonth) inheritedUsed = prev.used || 0;
    }

    const verifyToken = randomBytes(24).toString('hex');
    const userData = {
      username, email, pass: await bcrypt.hash(pass, 12),
      plan: 'free', active: true, // siempre free hasta que paguen
      emailVerified: false, emailVerifyToken: verifyToken,
      displayName: username, avatar:'👤', nameColor:'',
      invoices:[], history:[],
      notifications:[{ id:Date.now().toString(), icon:'🎉', title:'¡Bienvenido a Etify!',
        body:'Tu cuenta fue creada con éxito. Verificá tu email para empezar.', date:now.toISOString(), read:false }],
      used: inheritedUsed, resetMonth: curMonth, createdAt: now.toISOString()
    };
    await db.collection('users').doc(username).set(userData);
    // Enviar email de verificación (no bloquear si falla)
    sendVerificationEmail(email, username, verifyToken).catch(() => {});
    const jwtToken = signToken({ username, role:'user' });
    const { pass:_, emailVerifyToken:__, ...safe } = userData;
    return res.json({ token: jwtToken, user: safe });
  }

  // POST /api/auth  action=google
  if (action === 'google') {
    const { email, displayName } = req.body;
    if (!email) return res.status(400).json({ error: 'Faltan datos' });
    // Buscar usuario por email
    const snap = await db.collection('users').where('email','==',email).limit(1).get();
    if (!snap.empty) {
      // Usuario existente — devolver token sin verificar contraseña
      const ud = snap.docs[0].data();
      const token = signToken({ username: ud.username, role:'user' });
      const { pass:_, ...safe } = ud;
      return res.json({ token, user: safe, needsTos: !ud.tosAccepted });
    }
    // Usuario nuevo — registrar
    const safeUser = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '.');
    const username = (await db.collection('users').doc(safeUser).get()).exists
      ? safeUser + '_' + Date.now().toString().slice(-4)
      : safeUser;
    const now = new Date();
    const curMonth = now.getFullYear() * 100 + now.getMonth();

    // Heredar uso del mes si el email tuvo cuenta eliminada
    let inheritedUsed = 0;
    const deletedSnap = await db.collection('deleted_users').where('email', '==', email).limit(1).get();
    if (!deletedSnap.empty) {
      const prev = deletedSnap.docs[0].data();
      if (prev.resetMonth === curMonth) inheritedUsed = prev.used || 0;
    }

    const userData = {
      username, email, pass: await bcrypt.hash('__google__', 12),
      googleAuth: true, tosAccepted: false,
      emailVerified: true, // Google ya verificó el email
      plan: 'free', active: true,
      displayName: displayName || username, avatar:'👤', nameColor:'',
      invoices:[], history:[],
      notifications:[{ id:Date.now().toString(), icon:'🎉', title:'¡Bienvenido a Etify!',
        body:'Tu cuenta fue creada con éxito. ¡Empezá a combinar etiquetas!', date:now.toISOString(), read:false }],
      used: inheritedUsed, resetMonth: curMonth, createdAt: now.toISOString()
    };
    await db.collection('users').doc(username).set(userData);
    const token = signToken({ username, role:'user' });
    const { pass:_, ...safe } = userData;
    return res.json({ token, user: safe, needsTos: true });
  }

  // POST /api/auth  action=forgot-password
  if (action === 'forgot-password') {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Falta email' });
    const snap = await db.collection('users').where('email', '==', email).limit(1).get();
    if (snap.empty) return res.json({ ok: true }); // no revelar si el email existe
    const ud  = snap.docs[0].data();
    const token = (await import('crypto')).randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hora
    await snap.docs[0].ref.update({ resetToken: token, resetTokenExp: expires });
    const link = `https://etify.com.ar/?reset_token=${token}`;
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:    'Etify <noreply@etify.com.ar>',
        to:      [email],
        subject: '[Etify] Recuperá tu contraseña',
        html:    `<h2>Recuperar contraseña</h2>
                  <p>Hola ${ud.displayName || ud.username}, recibimos una solicitud para restablecer tu contraseña.</p>
                  <a href="${link}" style="display:inline-block;background:#3D8BFF;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Restablecer contraseña</a>
                  <p style="color:#888;font-size:12px;margin-top:16px">Este link expira en 1 hora. Si no solicitaste esto, ignorá este mensaje.</p>`
      })
    }).catch(() => {});
    return res.json({ ok: true });
  }

  // POST /api/auth  action=reset-password
  if (action === 'reset-password') {
    const { token, newPass } = req.body;
    if (!token || !newPass || newPass.length < 8) return res.status(400).json({ error: 'Datos inválidos' });
    const snap = await db.collection('users').where('resetToken', '==', token).limit(1).get();
    if (snap.empty) return res.status(400).json({ error: 'Link inválido o expirado.' });
    const ud = snap.docs[0].data();
    if (!ud.resetTokenExp || new Date(ud.resetTokenExp) < new Date())
      return res.status(400).json({ error: 'El link expiró. Solicitá uno nuevo.' });
    await snap.docs[0].ref.update({
      pass: await bcrypt.hash(newPass, 12),
      resetToken: null,
      resetTokenExp: null
    });
    return res.json({ ok: true });
  }

  res.status(400).json({ error: 'Acción inválida' });
}
