const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth = require('../middleware/auth');

// GET /api/agendamento-produtos/:agendamento_id
router.get('/:agendamento_id', auth(), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ap.*, p.imagem_url, p.unidade
       FROM agendamento_produtos ap
       LEFT JOIN produtos p ON ap.produto_id = p.id
       WHERE ap.agendamento_id = $1
       ORDER BY ap.id`,
      [req.params.agendamento_id]
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// POST /api/agendamento-produtos — adicionar produto ao agendamento
router.post('/', auth(), async (req, res) => {
  const { agendamento_id, produto_id, quantidade } = req.body;
  if (!agendamento_id || !produto_id)
    return res.status(400).json({ erro: 'agendamento_id e produto_id são obrigatórios' });
  try {
    // Busca o produto para pegar nome e preço atual
    const prod = await pool.query('SELECT * FROM produtos WHERE id = $1', [produto_id]);
    if (!prod.rows.length) return res.status(404).json({ erro: 'Produto não encontrado' });
    const p = prod.rows[0];
    const r = await pool.query(
      `INSERT INTO agendamento_produtos (agendamento_id, produto_id, nome_produto, preco_unitario, quantidade)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [agendamento_id, produto_id, p.nome, p.preco || 0, quantidade || 1]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// PUT /api/agendamento-produtos/:agendamento_id — salvar lista completa (substitui todos)
router.put('/:agendamento_id', auth(), async (req, res) => {
  const { produtos } = req.body; // [{ produto_id, quantidade }]
  const aid = req.params.agendamento_id;
  if (!Array.isArray(produtos)) return res.status(400).json({ erro: 'produtos deve ser um array' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Remove todos os produtos atuais do agendamento
    await client.query('DELETE FROM agendamento_produtos WHERE agendamento_id = $1', [aid]);
    // Insere os novos
    for (const item of produtos) {
      const prod = await client.query('SELECT * FROM produtos WHERE id = $1', [item.produto_id]);
      if (!prod.rows.length) continue;
      const p = prod.rows[0];
      await client.query(
        `INSERT INTO agendamento_produtos (agendamento_id, produto_id, nome_produto, preco_unitario, quantidade, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [aid, p.id, p.nome, p.preco || 0, item.quantidade || 1, (p.preco || 0) * (item.quantidade || 1)]
      );
    }
    await client.query('COMMIT');
    // Retorna a lista atualizada
    const r = await pool.query(
      `SELECT ap.*, p.imagem_url, p.unidade
       FROM agendamento_produtos ap
       LEFT JOIN produtos p ON ap.produto_id = p.id
       WHERE ap.agendamento_id = $1 ORDER BY ap.id`,
      [aid]
    );
    res.json(r.rows);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ erro: err.message });
  } finally { client.release(); }
});

// PATCH /api/agendamento-produtos/:id — atualizar quantidade
router.patch('/:id', auth(), async (req, res) => {
  const { quantidade } = req.body;
  try {
    const r = await pool.query(
      'UPDATE agendamento_produtos SET quantidade = $1 WHERE id = $2 RETURNING *',
      [quantidade, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// DELETE /api/agendamento-produtos/:id — remover item
router.delete('/:id', auth(), async (req, res) => {
  try {
    await pool.query('DELETE FROM agendamento_produtos WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

module.exports = router;