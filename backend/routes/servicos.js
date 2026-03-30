const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const auth = require('../middleware/auth');

router.get('/', async (req, res) => {
  const eid = req.query.empresa_id || req.usuario?.empresa_id;
  if (!eid) return res.status(400).json({ erro: 'empresa_id obrigatório' });
  try {
    const result = await pool.query(
      `SELECT * FROM servicos WHERE empresa_id = $1 AND ativo = true ORDER BY nome ASC`, [eid]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

router.post('/', auth(['admin']), async (req, res) => {
  const { nome, descricao, duracao_minutos, preco, cor } = req.body;
  const eid = req.usuario.empresa_id;
  if (!nome || !duracao_minutos) return res.status(400).json({ erro: 'Nome e duração obrigatórios' });
  try {
    const result = await pool.query(
      `INSERT INTO servicos (empresa_id, nome, descricao, duracao_minutos, preco, cor)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [eid, nome, descricao||null, duracao_minutos, preco||null, cor||'#0d9488']
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

router.patch('/:id', auth(['admin']), async (req, res) => {
  const { nome, descricao, duracao_minutos, preco, cor, ativo } = req.body;
  const eid = req.usuario.empresa_id;
  try {
    const result = await pool.query(
      `UPDATE servicos SET nome=COALESCE($1,nome), descricao=COALESCE($2,descricao),
       duracao_minutos=COALESCE($3,duracao_minutos), preco=COALESCE($4,preco),
       cor=COALESCE($5,cor), ativo=COALESCE($6,ativo)
       WHERE id=$7 AND empresa_id=$8 RETURNING *`,
      [nome, descricao, duracao_minutos, preco, cor, ativo, req.params.id, eid]
    );
    if (!result.rows.length) return res.status(404).json({ erro: 'Serviço não encontrado' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

module.exports = router;
