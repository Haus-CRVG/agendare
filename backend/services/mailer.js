const USE_RESEND = !!process.env.RESEND_API_KEY;
let resend = null, transporter = null;

console.log('Enviando email para:', para);

if (USE_RESEND) {
  const { Resend } = require('resend');
  resend = new Resend(process.env.RESEND_API_KEY);
  console.log('✅ Mailer: usando Resend');
} else {
  const nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
    tls: { rejectUnauthorized: false }
  });
  console.log('✅ Mailer: usando Nodemailer/Gmail');
}

const MAIL_FROM = process.env.MAIL_FROM || process.env.MAIL_USER || 'noreply@agendare.app';
const APP_URL   = process.env.APP_URL   || 'https://agendare-backend-production.up.railway.app';

// ── Função unificada de envio ─────────────────────────────
async function enviar({ para, assunto, html }) {
  if (USE_RESEND) {
    const { error } = await resend.emails.send({
      from:    MAIL_FROM,
      to:      para,
      subject: assunto,
      html
    });
    if (error) throw new Error(error.message || JSON.stringify(error));
  } else {
    await transporter.sendMail({
      from:    `"Agendare" <${MAIL_FROM}>`,
      to:      para,
      subject: assunto,
      html
    });
  }
}

// ── Template base ─────────────────────────────────────────
function formatarData(iso) {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function baseTemplate(conteudo) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"/>
<style>
  body{margin:0;padding:0;background:#f0f4f8;font-family:'Segoe UI',Arial,sans-serif;}
  .wrapper{max-width:560px;margin:32px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);}
  .header{background:linear-gradient(135deg,#0d9488,#0891b2);padding:32px;text-align:center;}
  .header h1{margin:0;color:#fff;font-size:1.6rem;letter-spacing:-0.02em;}
  .header p{margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:0.88rem;}
  .body{padding:32px;}
  .label{font-size:0.72rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:4px;}
  .value{font-size:0.95rem;color:#1e293b;margin-bottom:18px;font-weight:500;}
  .card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:20px;}
  .btn{display:inline-block;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:0.9rem;margin-top:8px;}
  .btn-primary{background:#0d9488;color:#ffffff;}
  .btn-danger{background:#ef4444;color:#ffffff;}
  .footer{text-align:center;padding:20px 32px;border-top:1px solid #f1f5f9;color:#94a3b8;font-size:0.75rem;}
</style>
</head>
<body><div class="wrapper">${conteudo}</div></body>
</html>`;
}

// ── Confirmação de agendamento ────────────────────────────
async function enviarConfirmacao({ para, nomeCliente, servico, profissional, dataInicio, tokenCancelamento }) {
  const html = baseTemplate(`
    <div class="header">
      <h1>📅 Agendamento Confirmado</h1>
      <p>Seu agendamento foi realizado com sucesso!</p>
    </div>
    <div class="body">
      <p style="color:#1e293b;margin-bottom:20px;">Olá, <strong>${nomeCliente}</strong>! Aqui estão os detalhes do seu agendamento:</p>
      <div class="card">
        <div class="label">Serviço</div><div class="value">${servico}</div>
        <div class="label">Profissional</div><div class="value">${profissional}</div>
        <div class="label">Data e Horário</div><div class="value">${formatarData(dataInicio)}</div>
      </div>
      <p style="color:#64748b;font-size:0.88rem;">Precisa cancelar ou remarcar?</p>
      <a href="${APP_URL}/cancelar?token=${tokenCancelamento}" class="btn btn-danger">Cancelar Agendamento</a>
    </div>
    <div class="footer">Agendare — Sistema de Agendamentos</div>
  `);
  await enviar({ para, assunto: `✅ Agendamento confirmado — ${servico}`, html });
}

// ── Cancelamento ──────────────────────────────────────────
async function enviarCancelamento({ para, nomeCliente, servico, dataInicio }) {
  const html = baseTemplate(`
    <div class="header" style="background:linear-gradient(135deg,#ef4444,#dc2626);">
      <h1>❌ Agendamento Cancelado</h1>
      <p>Seu agendamento foi cancelado</p>
    </div>
    <div class="body">
      <p style="color:#1e293b;margin-bottom:20px;">Olá, <strong>${nomeCliente}</strong>! Confirmamos o cancelamento do seu agendamento:</p>
      <div class="card">
        <div class="label">Serviço</div><div class="value">${servico}</div>
        <div class="label">Data e Horário</div><div class="value">${formatarData(dataInicio)}</div>
      </div>
      <p style="color:#64748b;font-size:0.88rem;">Deseja reagendar? Acesse nosso sistema de agendamentos.</p>
    </div>
    <div class="footer">Agendare — Sistema de Agendamentos</div>
  `);
  await enviar({ para, assunto: `❌ Agendamento cancelado — ${servico}`, html });
}

// ── Notificação para profissional ─────────────────────────
async function enviarNotificacaoProfissional({ para, nomeProfissional, cliente, servico, dataInicio }) {
  const html = baseTemplate(`
    <div class="header">
      <h1>🔔 Novo Agendamento</h1>
      <p>Você recebeu um novo agendamento</p>
    </div>
    <div class="body">
      <p style="color:#1e293b;margin-bottom:20px;">Olá, <strong>${nomeProfissional}</strong>! Você tem um novo agendamento:</p>
      <div class="card">
        <div class="label">Cliente</div><div class="value">${cliente}</div>
        <div class="label">Serviço</div><div class="value">${servico}</div>
        <div class="label">Data e Horário</div><div class="value">${formatarData(dataInicio)}</div>
      </div>
    </div>
    <div class="footer">Agendare — Sistema de Agendamentos</div>
  `);
  await enviar({ para, assunto: `🔔 Novo agendamento — ${cliente}`, html });
}

// ── Convite para participante interno ─────────────────────
async function enviarConviteParticipante({ nome, email, agendamento, token: tk }) {
  const BASE_URL = process.env.FRONTEND_URL || APP_URL;
  const urlConfirmar = `${BASE_URL}/responder-convite.html?token=${tk}&status=confirmado`;
  const urlCancelar  = `${BASE_URL}/responder-convite.html?token=${tk}&status=cancelado`;
  const dt = formatarData(agendamento.data_inicio);

  const html = `
  <div style="font-family:'Segoe UI',sans-serif;max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08)">
    <div style="background:#0d9488;padding:28px 32px">
      <span style="font-size:1.3rem;font-weight:800;color:#fff;letter-spacing:0.05em">AGENDARE</span>
    </div>
    <div style="padding:32px">
      <h2 style="margin:0 0 8px;color:#0f172a;font-size:1.2rem">Você foi convidado! 📅</h2>
      <p style="color:#64748b;margin:0 0 24px;font-size:0.92rem">
        Olá <strong>${nome}</strong>, você foi adicionado a um agendamento.
      </p>
      <div style="background:#f8fafc;border-radius:12px;padding:20px;margin-bottom:24px">
        <div style="margin-bottom:12px">
          <div style="font-size:0.72rem;color:#94a3b8;text-transform:uppercase;font-weight:700">Compromisso</div>
          <div style="font-weight:600;color:#0f172a">${agendamento.cliente_nome || agendamento.servico_nome || '—'}</div>
        </div>
        <div>
          <div style="font-size:0.72rem;color:#94a3b8;text-transform:uppercase;font-weight:700">Data e Horário</div>
          <div style="font-weight:600;color:#0f172a">${dt}</div>
        </div>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <a href="${urlConfirmar}" style="flex:1;min-width:140px;text-align:center;background:#0d9488;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.88rem">✅ Confirmar presença</a>
        <a href="${urlCancelar}"  style="flex:1;min-width:140px;text-align:center;background:#fff;color:#ef4444;border:1.5px solid #ef4444;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.88rem">❌ Não poderei participar</a>
      </div>
    </div>
    <div style="background:#f1f5f9;padding:16px 32px;text-align:center;font-size:0.78rem;color:#94a3b8">
      Agendare © ${new Date().getFullYear()} — Sistema de Agendamento
    </div>
  </div>`;

  await enviar({ para: email, assunto: `📅 Você foi convidado — ${agendamento.cliente_nome || 'Compromisso'}`, html });
  console.log(`✅ Convite enviado para ${email}`);
}

// ── Convite para pessoa externa ───────────────────────────
async function enviarConviteExterno({ para, titulo, organizador, dataInicio, dataFim, observacoes }) {
  const dtIni = formatarData(dataInicio);
  const dtFim = dataFim ? new Date(dataFim).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
  }) : null;

  const html = baseTemplate(`
    <div class="header">
      <h1>📅 Você foi convidado!</h1>
      <p>Um compromisso foi agendado com você</p>
    </div>
    <div class="body">
      <p style="color:#1e293b;margin-bottom:20px;">Você recebeu um convite de <strong>${organizador}</strong>:</p>
      <div class="card">
        <div class="label">Compromisso</div><div class="value">${titulo}</div>
        <div class="label">Organizado por</div><div class="value">${organizador}</div>
        <div class="label">Data e Horário</div>
        <div class="value">${dtIni}${dtFim ? ' até ' + dtFim : ''}</div>
        ${observacoes ? `<div class="label">Observações</div><div class="value">${observacoes}</div>` : ''}
      </div>
      <p style="color:#64748b;font-size:0.85rem;margin-top:1rem;">
        Este é um convite informativo enviado pelo sistema Agendare.
      </p>
    </div>
    <div class="footer">Agendare — Sistema de Agendamentos</div>
  `);

  await enviar({ para, assunto: `📅 Convite: ${titulo}`, html });
  console.log(`✅ Convite externo enviado para ${para}`);
}

module.exports = {
  enviarConfirmacao,
  enviarCancelamento,
  enviarNotificacaoProfissional,
  enviarConviteParticipante,
  enviarConviteExterno
};
