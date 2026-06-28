// Envío de emails con Resend (o nodemailer como fallback)
// Requiere env var RESEND_API_KEY

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { type, name, email, subject, message, plan, invoiceRequest } = req.body;
  if (!email || (!message && !invoiceRequest)) return res.status(400).json({ error: 'Faltan datos' });

  let emailSubject, emailBody;

  if (type === 'invoice_request') {
    emailSubject = `[Etify] Solicitud de factura - ${email}`;
    emailBody = `
<h2>Solicitud de Factura</h2>
<p><strong>Usuario:</strong> ${name}</p>
<p><strong>Email de la cuenta:</strong> ${email}</p>
<hr/>
<h3>Datos de facturación</h3>
<p><strong>Razón social / Nombre:</strong> ${invoiceRequest.razonSocial}</p>
<p><strong>CUIT:</strong> ${invoiceRequest.cuit}</p>
<p><strong>Condición IVA:</strong> ${invoiceRequest.condicionIVA}</p>
<p><strong>Domicilio:</strong> ${invoiceRequest.domicilio}</p>
<p><strong>Email para la factura:</strong> ${invoiceRequest.emailFactura}</p>
${invoiceRequest.comprobante ? `<p><strong>Comprobante:</strong> ${invoiceRequest.comprobante}</p>` : ''}
    `.trim();
  } else {
    emailSubject = `[Etify] ${subject || 'Consulta'} - ${name}`;
    emailBody = `
<h2>Nuevo mensaje de contacto</h2>
<p><strong>Nombre:</strong> ${name}</p>
<p><strong>Email:</strong> ${email}</p>
${plan ? `<p><strong>Plan de interés:</strong> ${plan}</p>` : ''}
<hr/>
<p>${message.replace(/\n/g, '<br/>')}</p>
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
