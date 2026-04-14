const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const auth = require('../middleware/auth');

// ── GET /api/servicos ───────────────────────────────────
router.get('/', auth(), async (req, res) => {
  const eid = req.query.empresa_id || req.usuario?.empresa_id;
  if (!eid) return res.status(400).json({ erro: 'empresa_id obrigatório' });

  try {
    const result = await pool.query(
      `SELECT * FROM servicos 
       WHERE empresa_id = $1 AND ativo = true 
       ORDER BY nome ASC`,
      [eid]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ── POST /api/servicos ──────────────────────────────────
router.post('/', auth(['admin']), async (req, res) => {
  const {
    nome,
    descricao,
    duracao_minutos,
    preco,
    cor,
    profissionais // ← NOVO
  } = req.body;

  const eid = req.usuario.empresa_id;

  if (!nome || !duracao_minutos) {
    return res.status(400).json({ erro: 'Nome e duração obrigatórios' });
  }

  try {
    // 1. Cria serviço
    const result = await pool.query(
      `INSERT INTO servicos 
        (empresa_id, nome, descricao, duracao_minutos, preco, cor)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [
        eid,
        nome,
        descricao || null,
        duracao_minutos,
        preco || null,
        cor || '#0d9488'
      ]
    );

    const servico = result.rows[0];

    // 2. Vincula profissionais
    if (profissionais?.length) {
      await Promise.all(
        profissionais.map(pid =>
          pool.query(
            `INSERT INTO profissional_servicos (profissional_id, servico_id)
             VALUES ($1,$2)
             ON CONFLICT DO NOTHING`,
            [pid, servico.id]
          )
        )
      );
    }

    res.json(servico);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ── PATCH /api/servicos/:id ─────────────────────────────
router.patch('/:id', auth(['admin']), async (req, res) => {
  const {
    nome,
    descricao,
    duracao_minutos,
    preco,
    cor,
    ativo,
    profissionais // ← NOVO
  } = req.body;

  const eid = req.usuario.empresa_id;
  const sid = req.params.id;

  try {
    // 1. Atualiza serviço
    const result = await pool.query(
      `UPDATE servicos SET 
        nome = COALESCE($1, nome),
        descricao = COALESCE($2, descricao),
        duracao_minutos = COALESCE($3, duracao_minutos),
        preco = COALESCE($4, preco),
        cor = COALESCE($5, cor),
        ativo = COALESCE($6, ativo)
       WHERE id = $7 AND empresa_id = $8
       RETURNING *`,
      [nome, descricao, duracao_minutos, preco, cor, ativo, sid, eid]
    );

    if (!result.rows.length) {
      return res.status(404).json({ erro: 'Serviço não encontrado' });
    }

    // 2. Atualiza vínculos com profissionais (se enviado)
    if (profissionais) {
      // remove antigos
      await pool.query(
        `DELETE FROM profissional_servicos WHERE servico_id = $1`,
        [sid]
      );

      // recria
      if (profissionais.length) {
        await Promise.all(
          profissionais.map(pid =>
            pool.query(
              `INSERT INTO profissional_servicos (profissional_id, servico_id)
               VALUES ($1,$2)`,
              [pid, sid]
            )
          )
        );
      }
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
const express = require('express');
const Router = express.Router();
const { pool } = require('../db');
const auth = require('../middleware/auth');

function normalizarProfissionais(body = {}) {
  if (Array.isArray(body.profissionais)) return body.profissionais;
  if (Array.isArray(body.profissionais_ids)) return body.profissionais_ids;
  return [];
}

router.get('/', auth(), async (req, res) => {
  const eid = req.query.empresa_id || req.usuario?.empresa_id;
  if (!eid) return res.status(400).json({ erro: 'empresa_id obrigatorio' });

  try {
    const result = await pool.query(
      `SELECT * FROM servicos
       WHERE empresa_id = $1 AND ativo = true
       ORDER BY nome ASC`,
      [eid]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.get('/:id', auth(['admin']), async (req, res) => {
  const eid = req.usuario.empresa_id;
  const sid = req.params.id;

  try {
    const result = await pool.query(
      `SELECT * FROM servicos
       WHERE id = $1 AND empresa_id = $2`,
      [sid, eid]
    );

    if (!result.rows.length) {
      return res.status(404).json({ erro: 'Servico nao encontrado' });
    }

    const vinculos = await pool.query(
      `SELECT profissional_id
       FROM profissional_servicos
       WHERE servico_id = $1`,
      [sid]
    );

    res.json({
      ...result.rows[0],
      profissionais_ids: vinculos.rows.map(v => v.profissional_id)
    });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.post('/', auth(['admin']), async (req, res) => {
  const { nome, descricao, duracao_minutos, preco, cor } = req.body;
  const profissionais = normalizarProfissionais(req.body);
  const eid = req.usuario.empresa_id;

  if (!nome || !duracao_minutos) {
    return res.status(400).json({ erro: 'Nome e duracao obrigatorios' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO servicos
        (empresa_id, nome, descricao, duracao_minutos, preco, cor)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [
        eid,
        nome,
        descricao || null,
        duracao_minutos,
        preco || null,
        cor || '#0d9488'
      ]
    );

    const servico = result.rows[0];

    if (profissionais.length) {
      await Promise.all(
        profissionais.map(pid =>
          pool.query(
            `INSERT INTO profissional_servicos (profissional_id, servico_id)
             VALUES ($1,$2)
             ON CONFLICT DO NOTHING`,
            [pid, servico.id]
          )
        )
      );
    }

    res.json(servico);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.patch('/:id', auth(['admin']), async (req, res) => {
  const { nome, descricao, duracao_minutos, preco, cor, ativo } = req.body;
  const profissionais = normalizarProfissionais(req.body);
  const eid = req.usuario.empresa_id;
  const sid = req.params.id;

  try {
    const result = await pool.query(
      `UPDATE servicos SET
        nome = COALESCE($1, nome),
        descricao = COALESCE($2, descricao),
        duracao_minutos = COALESCE($3, duracao_minutos),
        preco = COALESCE($4, preco),
        cor = COALESCE($5, cor),
        ativo = COALESCE($6, ativo)
       WHERE id = $7 AND empresa_id = $8
       RETURNING *`,
      [nome, descricao, duracao_minutos, preco, cor, ativo, sid, eid]
    );

    if (!result.rows.length) {
      return res.status(404).json({ erro: 'Servico nao encontrado' });
    }

    if (req.body.profissionais !== undefined || req.body.profissionais_ids !== undefined) {
      await pool.query(
        `DELETE FROM profissional_servicos WHERE servico_id = $1`,
        [sid]
      );

      if (profissionais.length) {
        await Promise.all(
          profissionais.map(pid =>
            pool.query(
              `INSERT INTO profissional_servicos (profissional_id, servico_id)
               VALUES ($1,$2)
               ON CONFLICT DO NOTHING`,
              [pid, sid]
            )
          )
        );
      }
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.put('/:id/profissionais', auth(['admin']), async (req, res) => {
  const sid = req.params.id;
  const eid = req.usuario.empresa_id;
  const profissionais = normalizarProfissionais(req.body);

  try {
    const servico = await pool.query(
      `SELECT id FROM servicos WHERE id = $1 AND empresa_id = $2`,
      [sid, eid]
    );

    if (!servico.rows.length) {
      return res.status(404).json({ erro: 'Servico nao encontrado' });
    }

    await pool.query(`DELETE FROM profissional_servicos WHERE servico_id = $1`, [sid]);

    if (profissionais.length) {
      await Promise.all(
        profissionais.map(pid =>
          pool.query(
            `INSERT INTO profissional_servicos (profissional_id, servico_id)
             VALUES ($1,$2)
             ON CONFLICT DO NOTHING`,
            [pid, sid]
          )
        )
      );
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.delete('/:id', auth(['admin']), async (req, res) => {
  const sid = req.params.id;
  const eid = req.usuario.empresa_id;

  try {
    await pool.query(`DELETE FROM profissional_servicos WHERE servico_id = $1`, [sid]);

    const result = await pool.query(
      `DELETE FROM servicos
       WHERE id = $1 AND empresa_id = $2
       RETURNING id`,
      [sid, eid]
    );

    if (!result.rows.length) {
      return res.status(404).json({ erro: 'Servico nao encontrado' });
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;