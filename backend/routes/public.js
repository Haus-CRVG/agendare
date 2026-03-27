const express = require('express');
const router  = express.Router();
const { pool } = require('../db');

// GET /api/public/:slug — dados da empresa para o link público de agendamento
router.get('/:slug', async (req, res) => {
  try {
    const emp = await pool.query(
      `SELECT id, nome_fantasia AS nome, email, telefone, slug, cor_primaria, logo_url
       FROM empresas WHERE slug=$1 AND status='ativo'`,
      [req.params.slug]
    );
    if (!emp.rows.length) return res.status(404).json({ erro: 'Empresa não encontrada' });
    const empresa = emp.rows[0];

    const servicos = await pool.query(
      `SELECT id, nome, descricao, duracao_minutos, preco, cor
       FROM servicos WHERE empresa_id=$1 AND ativo=true ORDER BY nome`,
      [empresa.id]
    );

    const profissionais = await pool.query(
      `SELECT u.id, u.nome, u.avatar_url,
              array_agg(ps.servico_id) FILTER (WHERE ps.servico_id IS NOT NULL) AS servicos_ids
       FROM usuarios u
       LEFT JOIN profissional_servicos ps ON ps.profissional_id = u.id
       WHERE u.empresa_id=$1 AND u.ativo=true AND u.perfil='profissional'
       GROUP BY u.id ORDER BY u.nome`,
      [empresa.id]
    );

    res.json({ empresa, servicos: servicos.rows, profissionais: profissionais.rows });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;