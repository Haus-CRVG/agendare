const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth = require('../middleware/auth');

// GET /api/clientes — lista clientes da empresa
router.get('/', auth(), async (req, res) => {
  const eid = req.usuario.empresa_id;
  const { busca } = req.query;
  try {
    let where = ['empresa_id = $1', 'ativo = true'];
    let params = [eid];
    if (busca) {
      where.push(`(nome ILIKE $2 OR email ILIKE $2 OR telefone ILIKE $2 OR cpf_cnpj ILIKE $2)`);
      params.push(`%${busca}%`);
    }
    const r = await pool.query(
      `SELECT * FROM clientes WHERE ${where.join(' AND ')} ORDER BY nome`,
      params
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// GET /api/clientes/:id — detalhe do cliente
router.get('/:id', auth(), async (req, res) => {
  const eid = req.usuario.empresa_id;
  try {
    const r = await pool.query(
      'SELECT * FROM clientes WHERE id = $1 AND empresa_id = $2',
      [req.params.id, eid]
    );
    if (!r.rows.length) return res.status(404).json({ erro: 'Cliente não encontrado' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// GET /api/clientes/:id/historico — agendamentos do cliente
router.get('/:id/historico', auth(), async (req, res) => {
  const eid = req.usuario.empresa_id;
  try {
    const cliente = await pool.query(
      'SELECT nome FROM clientes WHERE id = $1 AND empresa_id = $2',
      [req.params.id, eid]
    );
    if (!cliente.rows.length) return res.status(404).json({ erro: 'Cliente não encontrado' });
    const nome = cliente.rows[0].nome;
    const r = await pool.query(
      `SELECT a.*, u.nome as profissional_nome, s.nome as servico_nome
       FROM agendamentos a
       LEFT JOIN usuarios u ON a.profissional_id = u.id
       LEFT JOIN servicos s ON a.servico_id = s.id
       WHERE a.empresa_id = $1 AND a.cliente_nome ILIKE $2
       ORDER BY a.data_inicio DESC LIMIT 50`,
      [eid, `%${nome}%`]
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// POST /api/clientes — criar cliente
router.post('/', auth(), async (req, res) => {
  const eid = req.usuario.empresa_id;
  const { nome, email, telefone, cpf_cnpj, nascimento, endereco, observacoes } = req.body;
  if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' });
  try {
    const r = await pool.query(
      `INSERT INTO clientes (empresa_id, nome, email, telefone, cpf_cnpj, nascimento, endereco, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [eid, nome, email||null, telefone||null, cpf_cnpj||null,
       nascimento||null, endereco||null, observacoes||null]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ erro: 'Cliente já cadastrado com este e-mail' });
    res.status(500).json({ erro: err.message });
  }
});

// PATCH /api/clientes/:id — editar cliente
router.patch('/:id', auth(), async (req, res) => {
  const eid = req.usuario.empresa_id;
  const { nome, email, telefone, cpf_cnpj, nascimento, endereco, observacoes, ativo } = req.body;
  try {
    const r = await pool.query(
      `UPDATE clientes SET
        nome        = COALESCE($1, nome),
        email       = COALESCE($2, email),
        telefone    = COALESCE($3, telefone),
        cpf_cnpj    = COALESCE($4, cpf_cnpj),
        nascimento  = COALESCE($5, nascimento),
        endereco    = COALESCE($6, endereco),
        observacoes = COALESCE($7, observacoes),
        ativo       = COALESCE($8, ativo)
       WHERE id = $9 AND empresa_id = $10 RETURNING *`,
      [nome, email, telefone, cpf_cnpj, nascimento||null, endereco, observacoes, ativo, req.params.id, eid]
    );
    if (!r.rows.length) return res.status(404).json({ erro: 'Cliente não encontrado' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// DELETE /api/clientes/:id — inativar cliente
router.delete('/:id', auth(), async (req, res) => {
  const eid = req.usuario.empresa_id;
  try {
    await pool.query(
      'UPDATE clientes SET ativo = false WHERE id = $1 AND empresa_id = $2',
      [req.params.id, eid]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

module.exports = router;