import { rateLimit, getIp } from './_lib/rateLimit.js';

const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://etify.com.ar');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const ip = getIp(req);
  const rl = await rateLimit(`contact:${ip}`, 5, 60 * 60 * 1000); // 5 mensajes / hora
  if (!rl.allowed) return res.status(429).json({ error: 'Demasiados mensajes. Esperá un momento e intentá de nuevo.' });

  const { type, name, email, subject, message, plan, invoiceRequest } = req.body;
  if (!email || (!message && !invoiceRequest)) return res.status(400).json({ error: 'Faltan datos' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email inválido.' });

  let emailSubject, emailBody;

  if (type === 'invoice_request') {
    emailSubject = `[Etify] Solicitud de factura - ${esc(email)}`;
    emailBody = `
<h2>Solicitud de Factura</h2>
<p><strong>Usuario:</strong> ${esc(name)}</p>
<p><strong>Email de la cuenta:</strong> ${esc(email)}</p>
<hr/>
<h3>Datos de facturación</h3>
<p><strong>Razón social / Nombre:</strong> ${esc(invoiceRequest?.razonSocial)}</p>
<p><strong>CUIT:</strong> ${esc(invoiceRequest?.cuit)}</p>
<p><strong>Condición IVA:</strong> ${esc(invoiceRequest?.condicionIVA)}</p>
<p><strong>Domicilio:</strong> ${esc(invoiceRequest?.domicilio)}</p>
<p><strong>Email para la factura:</strong> ${esc(invoiceRequest?.emailFactura)}</p>
${invoiceRequest?.comprobante ? `<p><strong>Comprobante:</strong> ${esc(invoiceRequest.comprobante)}</p>` : ''}
    `.trim();
  } else {
    emailSubject = `[Etify] ${esc(subject || 'Consulta')} - ${esc(name)}`;
    emailBody = `
<h2>Nuevo mensaje de contacto</h2>
<p><strong>Nombre:</strong> ${esc(name)}</p>
<p><strong>Email:</strong> ${esc(email)}</p>
${plan ? `<p><strong>Plan de interés:</strong> ${esc(plan)}</p>` : ''}
<hr/>
<p>${esc(message).replace(/\n/g, '<br/>')}</p>
    `.trim();
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from:    'Etify <noreply@etify.com.ar>',
        to:      ['etify.ar@gmail.com'],
        reply_to: email,
        subject: emailSubject,
        html:    emailBody
      })
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.message || `Resend error ${r.status}`);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('Contact email error:', e);
    res.status(500).json({ error: e.message });
  }
}
