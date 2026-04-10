const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const auth = require('../middleware/auth');
const authInternal = require('../middleware/authInternal'); // ← importado UMA vez aqui
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
        SELECT u.id, u.nome, u.email, u.telefone, u.avatar_url, u.perfil, u.cor_agenda
        FROM usuarios u
        JOIN profissional_servicos ps ON ps.profissional_id = u.id
        WHERE u.empresa_id = $1 AND u.ativo = true AND ps.servico_id = $2
        ORDER BY u.nome ASC`;
      params = [eid, servico_id];
    } else {
      query = `SELECT id, nome, email, telefone, avatar_url, perfil, cor_agenda FROM usuarios WHERE empresa_id = $1 AND ativo = true ORDER BY nome ASC`;
      params = [eid];
    }
    res.json((await pool.query(query, params)).rows);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// ── POST /api/profissionais — criar ──────────────────────
// authInternal permite chamadas do backend do Implanta (sem token JWT)
// auth(['admin']) permite chamadas normais de admins logados
router.post('/', authInternal, auth(['admin']), async (req, res) => {
  const { nome, email, telefone, senha, perfil, servicos, empresa_id: eid_body } = req.body;

  // Se veio via authInternal (Implanta), usa empresa_id do body ou do header
  const eid = req.usuario?.empresa_id || eid_body;

  if (!eid) return res.status(400).json({ erro: 'empresa_id obrigatório' });
  if (!nome || !email || !senha) return res.status(400).json({ erro: 'Nome, e-mail e senha obrigatórios' });

  try {
    const hash = await bcrypt.hash(senha, 10);
    const result = await pool.query(
      `INSERT INTO usuarios (empresa_id, nome, email, telefone, senha, perfil) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, nome, email, telefone, perfil`,
      [eid, nome, email, telefone || null, hash, perfil || 'profissional']
    );
    const u = result.rows[0];

    if (servicos?.length) {
      for (const sid of servicos) {
        await pool.query(
          `INSERT INTO profissional_servicos (profissional_id, servico_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [u.id, sid]
        );
      }
    }

    // Disponibilidade padrão seg-sex 08:00-18:00
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
  const { disponibilidade } = req.body;
  const profId = parseInt(req.params.id);
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
  if (!senha || senha.length < 6)
    return res.status(400).json({ erro: 'Senha deve ter no mínimo 6 caracteres' });

  try {
    const hash = await bcrypt.hash(senha, 10);
    if (req.usuario.perfil === 'superadmin') {
      await pool.query(`UPDATE super_admins SET senha = $1 WHERE id = $2`, [hash, profId]);
    } else {
      await pool.query(`UPDATE usuarios SET senha = $1 WHERE id = $2`, [hash, profId]);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// ── PATCH /api/profissionais/:id — editar dados ───────────
router.patch('/:id', auth(['admin']), async (req, res) => {
  const { nome, email, telefone, perfil, cor_agenda } = req.body;
  try {
    const result = await pool.query(
      `UPDATE usuarios SET
        nome       = COALESCE($1, nome),
        email      = COALESCE($2, email),
        telefone   = COALESCE($3, telefone),
        perfil     = COALESCE($4, perfil),
        cor_agenda = COALESCE($5, cor_agenda)
       WHERE id = $6 AND empresa_id = $7
       RETURNING id, nome, email, perfil, cor_agenda`,
      [nome, email, telefone, perfil, cor_agenda, req.params.id, req.usuario.empresa_id]
    );
    if (!result.rows.length) return res.status(404).json({ erro: 'Usuário não encontrado' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

module.exports = router;
