import { db } from './_lib/firebase.js';
import { rateLimit, getIp } from './_lib/rateLimit.js';

function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendVerificationEmail(email, username, code) {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from:    'Etify <noreply@etify.com.ar>',
      to:      [email],
      subject: `${code} es tu código de verificación - Etify`,
      html:    `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
                  <h2 style="margin-bottom:8px">¡Bienvenido a Etify, ${username.replace(/</g,'&lt;').replace(/>/g,'&gt;')}!</h2>
                  <p style="color:#555">Ingresá este código en la app para verificar tu cuenta:</p>
                  <div style="font-size:40px;font-weight:900;letter-spacing:10px;text-align:center;background:#f5f5f5;padding:24px;border-radius:12px;margin:24px 0;color:#111">${code}</div>
                  <p style="color:#888;font-size:13px">Este código vence en 15 minutos. Si no creaste una cuenta en Etify, ignorá este mensaje.</p>
                </div>`
    })
  });
}

export { sendVerificationEmail, genCode };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://etify.com.ar');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { action } = req.body;

  // Verificar código ingresado por el usuario
  if (action === 'verify-code') {
    const { username, code } = req.body;
    if (!username || !code) return res.status(400).json({ error: 'Faltan datos' });
    const ip = getIp(req);
    const rl = await rateLimit(`verify-code:${ip}`, 10, 15 * 60 * 1000);
    if (!rl.allowed) return res.status(429).json({ error: 'Demasiados intentos. Esperá unos minutos.' });

    const ref = db.collection('users').doc(username);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Usuario no encontrado' });
    const ud = doc.data();

    if (ud.emailVerified) return res.json({ ok: true, already: true });
    if (!ud.emailVerifyToken || ud.emailVerifyToken !== String(code).trim())
      return res.status(400).json({ error: 'Código incorrecto.' });
    if (ud.emailVerifyTokenExp && new Date(ud.emailVerifyTokenExp) < new Date())
      return res.status(400).json({ error: 'El código expiró. Pedí uno nuevo.' });

    await ref.update({ emailVerified: true, emailVerifyToken: null, emailVerifyTokenExp: null });
    return res.json({ ok: true });
  }

  // Reenviar código — acepta username en body (usuario aún no verificado, no puede autenticarse)
  if (action === 'resend') {
    const ip = getIp(req);
    const rl = await rateLimit(`resend-verify:${ip}`, 3, 10 * 60 * 1000); // 3 reenvíos / 10 min
    if (!rl.allowed) return res.status(429).json({ error: 'Esperá unos minutos antes de reenviar.' });

    const username = req.body.username;
    if (!username) return res.status(400).json({ error: 'Faltan datos' });

    const ref = db.collection('users').doc(username);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Usuario no encontrado' });
    const ud = doc.data();
    if (ud.emailVerified) return res.json({ ok: true, already: true });

    const code = genCode();
    const exp  = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await ref.update({ emailVerifyToken: code, emailVerifyTokenExp: exp });
    await sendVerificationEmail(ud.email, ud.username || username, code).catch(() => {});
    return res.json({ ok: true });
  }

  res.status(400).json({ error: 'Acción inválida' });
}
