import { db }          from './_lib/firebase.js';
import { requireAuth } from './_lib/auth.js';
import { randomBytes } from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const payload = requireAuth(req, res);
  if (!payload) return;

  const ref = db.collection('users').doc(payload.username);
  const doc = await ref.get();
  if (!doc.exists) return res.status(404).json({ error: 'Usuario no encontrado' });

  const ud = doc.data();
  if (ud.emailVerified) return res.json({ ok: true, already: true });

  const token = randomBytes(24).toString('hex');
  await ref.update({ emailVerifyToken: token });

  const link = `https://etify.com.ar/api/verify-email?token=${token}`;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from:    'Etify <noreply@etify.com.ar>',
      to:      [ud.email],
      subject: '[Etify] Verificá tu cuenta',
      html:    `<h2>Verificá tu cuenta de Etify</h2>
                <p>Hacé click en el botón para confirmar tu dirección de email:</p>
                <a href="${link}" style="display:inline-block;background:#3D8BFF;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Verificar mi cuenta</a>
                <p style="color:#888;font-size:12px;margin-top:16px">Si no creaste una cuenta en Etify, ignorá este mensaje.</p>`
    })
  });

  res.json({ ok: true });
}
