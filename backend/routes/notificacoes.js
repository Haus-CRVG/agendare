const express = require('express');
const router = express.Router();
const pool = require('../db');
const auth = require('../middleware/auth');

router.get('/', auth(), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM notificacoes WHERE usuario_id = $1 AND lida = false ORDER BY criado_em DESC LIMIT 50`,
      [req.usuario.id]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

router.patch('/:id/lida', auth(), async (req, res) => {
  try {
    await pool.query(`UPDATE notificacoes SET lida = true WHERE id = $1 AND usuario_id = $2`, [req.params.id, req.usuario.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

module.exports = router;
