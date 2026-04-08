// routes/sso.js  — Backend do AGENDARE
const express  = require('express');
const jwt      = require('jsonwebtoken');
const { pool } = require('../db');
const router   = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'agendare_chave_secreta_2025';
const SSO_SECRET = process.env.SSO_SECRET || 'sso_chave_compartilhada_2025';
// ⚠️  SSO_SECRET deve ser IGUAL ao definido no Implanta

/**
 * POST /api/sso/validar
 * Recebe o token SSO gerado pelo Implanta e devolve um JWT do Agendare.
 * Usa CNPJ para encontrar a empresa correta no banco do Agendare,
 * independente do empresa_id (que pode ser diferente entre os sistemas).
 */
router.post('/validar', async (req, res) => {
  const { sso_token } = req.body;
  if (!sso_token) return res.status(400).json({ erro: 'Token SSO ausente' });

  // 1. Verifica e decodifica o token SSO
  let payload;
  try {
    payload = jwt.verify(sso_token, SSO_SECRET);
  } catch (e) {
    return res.status(401).json({ erro: 'Token SSO inválido ou expirado' });
  }

  const { email, cnpj } = payload;

  try {
    // 2. Encontra a empresa no Agendare pelo CNPJ (remove formatação)
    const empQ = await pool.query(
      `SELECT id, slug FROM empresas
       WHERE REGEXP_REPLACE(cnpj, '\\D', '', 'g') = $1
       AND status = 'ativo'
       LIMIT 1`,
      [cnpj]
    );

    if (!empQ.rows.length) {
      return res.status(404).json({
        erro: 'Empresa não encontrada no Agendare. Verifique se o CNPJ está cadastrado.'
      });
    }

    const empresa_id = empQ.rows[0].id;
    const slug       = empQ.rows[0].slug || '';

    // 3. Busca o usuário pelo e-mail + empresa encontrada
    const userQ = await pool.query(
      `SELECT id, nome, email, perfil, empresa_id
       FROM usuarios
       WHERE email = $1 AND empresa_id = $2 AND ativo = true
       LIMIT 1`,
      [email, empresa_id]
    );

    if (!userQ.rows.length) {
      return res.status(404).json({
        erro: 'Usuário não encontrado no Agendare. Verifique se o e-mail está cadastrado.'
      });
    }

    const user = userQ.rows[0];

    // 4. Gera JWT do Agendare no mesmo formato do login normal
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
