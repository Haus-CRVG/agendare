// routes/sso.js  — Backend do AGENDARE
// Adicione no server.js: app.use('/api/sso', require('./routes/sso'));

const express = require('express');
const jwt     = require('jsonwebtoken');
const { pool } = require('../db');
const router  = express.Router();

const JWT_SECRET     = process.env.JWT_SECRET || 'agendare_chave_secreta_2025';
const SSO_SECRET     = process.env.SSO_SECRET || 'sso_chave_compartilhada_2025';
// ⚠️  Defina SSO_SECRET igual nos dois sistemas (Agendare e Implanta)

/**
 * POST /api/sso/validar
 * Recebe o token SSO gerado pelo Implanta e devolve um JWT do Agendare.
 * Chamado pelo frontend do Agendare quando detecta ?sso=TOKEN na URL.
 */
router.post('/validar', async (req, res) => {
  const { sso_token } = req.body;
  if (!sso_token) return res.status(400).json({ erro: 'Token SSO ausente' });

  let payload;
  try {
    payload = jwt.verify(sso_token, SSO_SECRET);
  } catch (e) {
    return res.status(401).json({ erro: 'Token SSO inválido ou expirado' });
  }

  const { email, empresa_id } = payload;

  try {
    // Busca o profissional no Agendare pelo e-mail e empresa
    const q = await pool.query(
      `SELECT p.id, p.nome, p.email, p.perfil, p.empresa_id
       FROM profissionais p
       WHERE p.email = $1 AND p.empresa_id = $2 AND p.ativo = true
       LIMIT 1`,
      [email, empresa_id]
    );

    if (!q.rows.length) {
      return res.status(404).json({
        erro: 'Usuário não encontrado no Agendare. Verifique se o e-mail está cadastrado.'
      });
    }

    const user = q.rows[0];

    // Busca slug da empresa para o link público
    const empQ = await pool.query(
      'SELECT slug FROM empresas WHERE id = $1', [empresa_id]
    );
    const slug = empQ.rows[0]?.slug || '';

    // Gera JWT do Agendare (mesmo formato do login normal)
    const token = jwt.sign(
      { id: user.id, email: user.email, perfil: user.perfil, empresa_id: user.empresa_id },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      usuario: {
        id:         user.id,
        nome:       user.nome,
        email:      user.email,
        perfil:     user.perfil,
        empresa_id: user.empresa_id,
        slug
      }
    });

  } catch (err) {
    console.error('[SSO] Erro ao validar:', err.message);
    res.status(500).json({ erro: 'Erro interno ao validar SSO' });
  }
});

module.exports = router;
