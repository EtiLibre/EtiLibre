import { db } from './firebase.js';

/**
 * Rate limiter usando Firestore.
 * @param {string} key     — identificador único (ej: "login:1.2.3.4")
 * @param {number} max     — máximo de intentos permitidos
 * @param {number} windowMs — ventana de tiempo en ms
 * @returns {Promise<{ allowed: boolean, remaining: number }>}
 */
export async function rateLimit(key, max, windowMs) {
  const ref  = db.collection('rate_limits').doc(key.replace(/[\/\.]/g, '_'));
  const now  = Date.now();
  const doc  = await ref.get();

  if (!doc.exists) {
    await ref.set({ count: 1, windowStart: now });
    return { allowed: true, remaining: max - 1 };
  }

  const { count, windowStart } = doc.data();

  // Ventana expirada — resetear
  if (now - windowStart > windowMs) {
    await ref.set({ count: 1, windowStart: now });
    return { allowed: true, remaining: max - 1 };
  }

  // Dentro de la ventana
  if (count >= max) {
    const retryAfter = Math.ceil((windowStart + windowMs - now) / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }

  await ref.update({ count: count + 1 });
  return { allowed: true, remaining: max - count - 1 };
}

export function getIp(req) {
  // x-vercel-forwarded-for es la IP del cliente tal como la ve el edge de Vercel (no falsificable)
  // x-forwarded-for puede ser inyectado por el cliente — no usar para rate limiting
  return req.headers['x-vercel-forwarded-for']
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';
}
