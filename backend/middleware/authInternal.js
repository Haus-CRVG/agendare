// middleware/authInternal.js — Agendare Backend
// Permite que o backend do Implanta chame rotas internas do Agendare
// sem precisar de um token JWT de usuário

const AGENDARE_INTERNAL_SECRET = process.env.AGENDARE_INTERNAL_SECRET || 'implanta_agendare_secret_2025';
// ⚠️ Defina AGENDARE_INTERNAL_SECRET igual nos dois sistemas no Railway

function authInternal(req, res, next) {
  const secret = req.headers['x-internal-secret'];
  if (secret && secret === AGENDARE_INTERNAL_SECRET) {
    // Simula um usuário superadmin para ter acesso total nas rotas
    req.usuario = {
      perfil: 'superadmin',
      empresa_id: req.headers['x-empresa-id'] ? parseInt(req.headers['x-empresa-id']) : null
    };
    return next();
  }
  // Se não tem secret interno, passa para o próximo middleware (auth normal)
  next();
}

module.exports = authInternal;
