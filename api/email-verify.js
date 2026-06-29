import { db }          from './_lib/firebase.js';
import { requireAuth } from './_lib/auth.js';
import { randomBytes } from 'crypto';

async function sendVerificationEmail(email, username, token) {
  const link = `https://etify.com.ar/api/email-verify?token=${token}`;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from:    'Etify <noreply@etify.com.ar>',
      to:      [email],
      subject: '[Etify] Verificá tu cuenta',
      html:    `<h2>¡Bienvenido a Etify, ${username}!</h2>
                <p>Hacé click en el siguiente botón para verificar tu cuenta:</p>
                <a href="${link}" style="display:inline-block;background:#3D8BFF;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Verificar mi cuenta</a>
                <p style="color:#888;font-size:12px;margin-top:16px">Si no creaste una cuenta en Etify, ignorá este mensaje.</p>`
    })
  });
}

export { sendVerificationEmail };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — verificar email via token del link
  if (req.method === 'GET') {
    const { token } = req.query;
    if (!token) return res.status(400).send('Token inválido.');
    const snap = await db.collection('users').where('emailVerifyToken', '==', token).limit(1).get();
    if (snap.empty) return res.status(400).send('El link de verificación no es válido o ya fue usado.');
    await snap.docs[0].ref.update({ emailVerified: true, emailVerifyToken: null });
    res.setHeader('Location', '/?email_verified=1');
    return res.status(302).end();
  }

  // POST — reenviar email de verificación (requiere auth)
  if (req.method === 'POST') {
    const payload = requireAuth(req, res);
    if (!payload) return;
    const ref = db.collection('users').doc(payload.username);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Usuario no encontrado' });
    const ud = doc.data();
    if (ud.emailVerified) return res.json({ ok: true, already: true });
    const token = randomBytes(24).toString('hex');
    await ref.update({ emailVerifyToken: token });
    await sendVerificationEmail(ud.email, ud.username || payload.username, token);
    return res.json({ ok: true });
  }

  res.status(405).end();
}
