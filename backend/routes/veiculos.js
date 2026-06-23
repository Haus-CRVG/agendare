const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth = require('../middleware/auth');

// GET /api/veiculos?placa=ABC1234 — busca por placa
router.get('/', auth(), async (req, res) => {
  const eid = req.usuario.empresa_id;
  const { placa, cliente_id } = req.query;
  try {
    let where = ['v.empresa_id = $1'];
    let params = [eid];
    let idx = 2;
    if (placa)     { where.push(`UPPER(v.placa) = $${idx++}`); params.push(placa.toUpperCase().replace(/[^A-Z0-9]/g,'')); }
    if (cliente_id){ where.push(`v.cliente_id = $${idx++}`); params.push(cliente_id); }
    const r = await pool.query(`
      SELECT v.*, c.nome as cliente_nome, c.telefone as cliente_telefone
      FROM veiculos v
      LEFT JOIN clientes c ON v.cliente_id = c.id
      WHERE ${where.join(' AND ')}
      ORDER BY v.criado_em DESC`, params);
    res.json(r.rows);
  } catch(err) { res.status(500).json({ erro: err.message }); }
});

// GET /api/veiculos/:id/historico — histórico de atendimentos do veículo
router.get('/:id/historico', auth(), async (req, res) => {
  const eid = req.usuario.empresa_id;
  try {
    const r = await pool.query(`
      SELECT a.*,
             u.nome as profissional_nome,
             s.nome as servico_nome,
             COALESCE((
               SELECT json_agg(json_build_object(
                 'descricao', io.descricao,
                 'valor_unitario', io.valor_unitario,
                 'quantidade', io.quantidade,
                 'subtotal', io.subtotal,
                 'tipo', io.tipo
               ) ORDER BY io.id)
               FROM itens_ordem io WHERE io.agendamento_id = a.id
             ), '[]') as itens,
             COALESCE((SELECT SUM(io.subtotal) FROM itens_ordem io WHERE io.agendamento_id = a.id), 0) as total
      FROM agendamentos a
      LEFT JOIN usuarios u ON a.profissional_id = u.id
      LEFT JOIN servicos s ON a.servico_id = s.id
      WHERE a.veiculo_id = $1 AND a.empresa_id = $2
      ORDER BY a.data_inicio DESC`, [req.params.id, eid]);
    res.json(r.rows);
  } catch(err) { res.status(500).json({ erro: err.message }); }
});

// POST /api/veiculos — criar/atualizar veículo
router.post('/', auth(), async (req, res) => {
  const eid = req.usuario.empresa_id;
  const { placa, montadora, modelo, ano, km_atual, cliente_id, observacoes } = req.body;
  if (!placa) return res.status(400).json({ erro: 'Placa é obrigatória' });
  const placaLimpa = placa.toUpperCase().replace(/[^A-Z0-9]/g,'');
  try {
    const r = await pool.query(`
      INSERT INTO veiculos (empresa_id, placa, montadora, modelo, ano, km_atual, cliente_id, observacoes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (empresa_id, placa) DO UPDATE SET
        montadora   = COALESCE($3, veiculos.montadora),
        modelo      = COALESCE($4, veiculos.modelo),
        ano         = COALESCE($5, veiculos.ano),
        km_atual    = COALESCE($6, veiculos.km_atual),
        cliente_id  = COALESCE($7, veiculos.cliente_id),
        observacoes = COALESCE($8, veiculos.observacoes)
      RETURNING *`,
      [eid, placaLimpa, montadora||null, modelo||null, ano||null, km_atual||null, cliente_id||null, observacoes||null]
    );
    res.status(201).json(r.rows[0]);
  } catch(err) { res.status(500).json({ erro: err.message }); }
});

// PATCH /api/veiculos/:id — atualizar veículo
router.patch('/:id', auth(), async (req, res) => {
  const eid = req.usuario.empresa_id;
  const { montadora, modelo, ano, km_atual, cliente_id, observacoes } = req.body;
  try {
    const r = await pool.query(`
      UPDATE veiculos SET
        montadora   = COALESCE($1, montadora),
        modelo      = COALESCE($2, modelo),
        ano         = COALESCE($3, ano),
        km_atual    = COALESCE($4, km_atual),
        cliente_id  = COALESCE($5, cliente_id),
        observacoes = COALESCE($6, observacoes)
      WHERE id = $7 AND empresa_id = $8 RETURNING *`,
      [montadora||null, modelo||null, ano||null, km_atual||null, cliente_id||null, observacoes||null, req.params.id, eid]
    );
    if (!r.rows.length) return res.status(404).json({ erro: 'Veículo não encontrado' });
    res.json(r.rows[0]);
  } catch(err) { res.status(500).json({ erro: err.message }); }
});

module.exports = router;