const express = require('express');
const router = express.Router();
const pool = require('../db');
const auth = require('../middleware/auth');
const bcrypt = require('bcryptjs');

// ── GET /api/profissionais — lista da empresa ─────────────
router.get('/', async (req, res) => {
  const eid = req.query.empresa_id || req.usuario?.empresa_id;
  if (!eid) return res.status(400).json({ erro: 'empresa_id obrigatório' });
  const servico_id = req.query.servico_id;
  try {
    let query, params;
    if (servico_id) {
      query = `
        SELECT u.id, u.nome, u.email, u.telefone, u.avatar_url, u.perfil
        FROM usuarios u
        JOIN profissional_servicos ps ON ps.profissional_id = u.id
        WHERE u.empresa_id = $1 AND u.ativo = true AND ps.servico_id = $2
        ORDER BY u.nome ASC`;
      params = [eid, servico_id];
    } else {
      query = `SELECT id, nome, email, telefone, avatar_url, perfil FROM usuarios WHERE empresa_id = $1 AND ativo = true ORDER BY nome ASC`;
      params = [eid];
    }
    res.json((await pool.query(query, params)).rows);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// ── POST /api/profissionais — criar ──────────────────────
router.post('/', auth(['admin']), async (req, res) => {
  const { nome, email, telefone, senha, perfil, servicos } = req.body;
  const eid = req.usuario.empresa_id;
  if (!nome || !email || !senha) return res.status(400).json({ erro: 'Nome, e-mail e senha obrigatórios' });
  try {
    const hash = await bcrypt.hash(senha, 10);
    const result = await pool.query(
      `INSERT INTO usuarios (empresa_id, nome, email, telefone, senha, perfil) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, nome, email, telefone, perfil`,
      [eid, nome, email, telefone || null, hash, perfil || 'profissional']
    );
    const u = result.rows[0];
    // Vincula serviços
    if (servicos?.length) {
      for (const sid of servicos) {
        await pool.query(`INSERT INTO profissional_servicos (profissional_id, servico_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [u.id, sid]);
      }
    }
    // Configura disponibilidade padrão (seg-sex 08:00-18:00)
    for (let dia = 1; dia <= 5; dia++) {
      await pool.query(
        `INSERT INTO disponibilidade (profissional_id, dia_semana, hora_inicio, hora_fim) VALUES ($1,$2,'08:00','18:00')`,
        [u.id, dia]
      );
    }
    res.json(u);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ erro: 'E-mail já cadastrado' });
    res.status(500).json({ erro: err.message });
  }
});

// ── GET /api/profissionais/:id/disponibilidade ────────────
router.get('/:id/disponibilidade', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM disponibilidade WHERE profissional_id = $1 ORDER BY dia_semana ASC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// ── PUT /api/profissionais/:id/disponibilidade ────────────
router.put('/:id/disponibilidade', auth(), async (req, res) => {
  const { disponibilidade } = req.body; // array de { dia_semana, hora_inicio, hora_fim, ativo }
  const profId = parseInt(req.params.id);
  // Só o próprio profissional ou admin pode editar
  if (req.usuario.perfil !== 'admin' && req.usuario.id !== profId) {
    return res.status(403).json({ erro: 'Sem permissão' });
  }
  try {
    await pool.query(`DELETE FROM disponibilidade WHERE profissional_id = $1`, [profId]);
    for (const d of disponibilidade) {
      if (d.ativo) {
        await pool.query(
          `INSERT INTO disponibilidade (profissional_id, dia_semana, hora_inicio, hora_fim) VALUES ($1,$2,$3,$4)`,
          [profId, d.dia_semana, d.hora_inicio, d.hora_fim]
        );
      }
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// ── PATCH /api/profissionais/:id/senha ───────────────────
router.patch('/:id/senha', auth(), async (req, res) => {
  const { senha } = req.body;
  const profId = parseInt(req.params.id);
  if (req.usuario.perfil !== 'admin' && req.usuario.id !== profId)
    return res.status(403).json({ erro: 'Sem permissão' });
  if (!senha || senha.length < 6) return res.status(400).json({ erro: 'Senha deve ter no mínimo 6 caracteres' });
  try {
    const hash = await bcrypt.hash(senha, 10);
    await pool.query(`UPDATE usuarios SET senha = $1 WHERE id = $2`, [hash, profId]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

module.exports = router;
