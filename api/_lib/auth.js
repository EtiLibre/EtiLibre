import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET;

export function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '7d' });
}

export function verifyToken(token) {
  try { return jwt.verify(token, SECRET); }
  catch { return null; }
}

export function requireAuth(req, res) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ error: 'No autorizado' }); return null; }
  const payload = verifyToken(auth.slice(7));
  if (!payload) { res.status(401).json({ error: 'Sesión inválida o expirada' }); return null; }
  return payload;
}

export function requireAdmin(req, res) {
  const payload = requireAuth(req, res);
  if (!payload) return null;
  if (payload.role !== 'admin') { res.status(403).json({ error: 'Acceso denegado' }); return null; }
  return payload;
}
