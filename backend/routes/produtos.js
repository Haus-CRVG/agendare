const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth = require('../middleware/auth');

// GET /api/produtos — lista produtos da empresa
router.get('/', auth(), async (req, res) => {
  const eid = req.usuario.empresa_id;
  try {
    const r = await pool.query(
      `SELECT * FROM produtos WHERE empresa_id = $1 ORDER BY ativo DESC, categoria, nome`,
      [eid]
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// GET /api/produtos/categorias — lista categorias únicas
router.get('/categorias', auth(), async (req, res) => {
  const eid = req.usuario.empresa_id;
  try {
    const r = await pool.query(
      `SELECT DISTINCT categoria FROM produtos WHERE empresa_id = $1 AND categoria IS NOT NULL ORDER BY categoria`,
      [eid]
    );
    res.json(r.rows.map(x => x.categoria));
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// GET /api/produtos/:id
router.get('/:id', auth(), async (req, res) => {
  const eid = req.usuario.empresa_id;
  try {
    const r = await pool.query(
      'SELECT * FROM produtos WHERE id = $1 AND empresa_id = $2',
      [req.params.id, eid]
    );
    if (!r.rows.length) return res.status(404).json({ erro: 'Produto não encontrado' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// POST /api/produtos — criar produto
router.post('/', auth(), async (req, res) => {
  const eid = req.usuario.empresa_id;
  const { nome, descricao, preco, categoria, unidade, tempo_preparo, imagem_url, ativo } = req.body;
  if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' });
  try {
    const r = await pool.query(
      `INSERT INTO produtos (empresa_id, nome, descricao, preco, categoria, unidade, tempo_preparo, imagem_url, ativo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [eid, nome, descricao||null, preco||null, categoria||null,
       unidade||'unidade', tempo_preparo||null, imagem_url||null, ativo !== false]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// PATCH /api/produtos/:id — editar produto
router.patch('/:id', auth(), async (req, res) => {
  const eid = req.usuario.empresa_id;
  const { nome, descricao, preco, categoria, unidade, tempo_preparo, imagem_url, ativo } = req.body;
  try {
    const r = await pool.query(
      `UPDATE produtos SET
        nome          = COALESCE($1, nome),
        descricao     = COALESCE($2, descricao),
        preco         = COALESCE($3, preco),
        categoria     = COALESCE($4, categoria),
        unidade       = COALESCE($5, unidade),
        tempo_preparo = COALESCE($6, tempo_preparo),
        imagem_url    = COALESCE($7, imagem_url),
        ativo         = COALESCE($8, ativo)
       WHERE id = $9 AND empresa_id = $10 RETURNING *`,
      [nome||null, descricao||null, preco||null, categoria||null,
       unidade||null, tempo_preparo||null, imagem_url||null,
       ativo !== undefined ? ativo : null,
       req.params.id, eid]
    );
    if (!r.rows.length) return res.status(404).json({ erro: 'Produto não encontrado' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// DELETE /api/produtos/:id — inativar produto
router.delete('/:id', auth(), async (req, res) => {
  const eid = req.usuario.empresa_id;
  try {
    await pool.query(
      'UPDATE produtos SET ativo = false WHERE id = $1 AND empresa_id = $2',
      [req.params.id, eid]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

module.exports = router;