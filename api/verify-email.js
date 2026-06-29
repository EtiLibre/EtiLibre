import { db } from './_lib/firebase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const { token } = req.query;
  if (!token) return res.status(400).send('Token inválido.');

  const snap = await db.collection('users').where('emailVerifyToken', '==', token).limit(1).get();
  if (snap.empty) return res.status(400).send('El link de verificación no es válido o ya fue usado.');

  const doc = snap.docs[0];
  await doc.ref.update({ emailVerified: true, emailVerifyToken: null });

  // Redirigir al sitio con mensaje de éxito
  res.redirect(302, '/?email_verified=1');
}
