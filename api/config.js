import { db }           from './_lib/firebase.js';
import { requireAdmin } from './_lib/auth.js';
import { verifyToken }  from './_lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://etify.com.ar');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET is public (any authenticated user can read config)
  if (req.method === 'GET') {
    const { key } = req.query;
    if (!key) return res.status(400).json({ error: 'key required' });
    try {
      const doc = await db.collection('config').doc(key).get();
      return res.json(doc.exists ? doc.data().value : null);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // PUT requires admin
  const payload = requireAdmin(req, res);
  if (!payload) return;

  if (req.method === 'PUT') {
    const { key, value } = req.body || {};
    if (!key || value === undefined) return res.status(400).json({ error: 'key and value required' });
    try {
      await db.collection('config').doc(key).set({ value, updatedAt: new Date().toISOString() });
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
