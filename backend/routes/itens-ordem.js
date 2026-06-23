const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth = require('../middleware/auth');

// GET /api/itens-ordem/:agendamento_id
router.get('/:agendamento_id', auth(), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT io.*, p.referencia as produto_referencia
       FROM itens_ordem io
       LEFT JOIN produtos p ON io.produto_id = p.id
       WHERE io.agendamento_id = $1 ORDER BY io.id`,
      [req.params.agendamento_id]
    );
    res.json(r.rows);
  } catch(err) { res.status(500).json({ erro: err.message }); }
});

// PUT /api/itens-ordem/:agendamento_id — salva lista completa
router.put('/:agendamento_id', auth(), async (req, res) => {
  const { itens } = req.body;
  const aid = req.params.agendamento_id;
  if (!Array.isArray(itens)) return res.status(400).json({ erro: 'itens deve ser array' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM itens_ordem WHERE agendamento_id = $1', [aid]);
    for (const item of itens) {
      const sub = (parseFloat(item.valor_unitario)||0) * (parseInt(item.quantidade)||1);
      await client.query(
        `INSERT INTO itens_ordem (agendamento_id, produto_id, descricao, valor_unitario, quantidade, subtotal, tipo)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [aid, item.produto_id||null, item.descricao, parseFloat(item.valor_unitario)||0,
         parseInt(item.quantidade)||1, sub, item.tipo||'manual']
      );
    }
    await client.query('COMMIT');
    const r = await pool.query('SELECT * FROM itens_ordem WHERE agendamento_id = $1 ORDER BY id', [aid]);
    res.json(r.rows);
  } catch(err) {
    await client.query('ROLLBACK');
    res.status(500).json({ erro: err.message });
  } finally { client.release(); }
});

// DELETE /api/itens-ordem/item/:id
router.delete('/item/:id', auth(), async (req, res) => {
  try {
    await pool.query('DELETE FROM itens_ordem WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ erro: err.message }); }
});

module.exports = router;