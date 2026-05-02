const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth = require('../middleware/auth');

// Lista de módulos disponíveis no sistema
const MODULOS_DISPONIVEIS = [
  { id: 'clientes',      label: '👥 Clientes',              descricao: 'Cadastro e histórico de clientes' },
  { id: 'produtos',      label: '📦 Produtos',              descricao: 'Catálogo de produtos' },
  { id: 'financeiro',    label: '💰 Financeiro',            descricao: 'Controle financeiro e pagamentos' },
  { id: 'relatorios',    label: '📊 Relatórios',            descricao: 'Relatórios e análises' },
  { id: 'whatsapp',      label: '💬 Notificações WhatsApp', descricao: 'Envio automático via WhatsApp' },
  { id: 'email_auto',    label: '📧 Notificações E-mail',   descricao: 'Envio automático de e-mails' },
];

// GET /api/modulos/disponiveis — lista todos os módulos do sistema
router.get('/disponiveis', (req, res) => {
  res.json(MODULOS_DISPONIVEIS);
});

// GET /api/modulos/minha-empresa — módulos ativos da empresa logada
router.get('/minha-empresa', auth(), async (req, res) => {
  const eid = req.usuario.empresa_id;
  if (!eid) return res.json([]);
  try {
    const r = await pool.query(
      'SELECT modulo FROM modulos_empresa WHERE empresa_id = $1 AND ativo = true',
      [eid]
    );
    res.json(r.rows.map(x => x.modulo));
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// GET /api/modulos/:empresa_id — módulos de uma empresa (superadmin)
router.get('/:empresa_id', auth(['superadmin']), async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT modulo, ativo FROM modulos_empresa WHERE empresa_id = $1',
      [req.params.empresa_id]
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// PUT /api/modulos/:empresa_id — salva módulos de uma empresa (superadmin)
router.put('/:empresa_id', auth(['superadmin']), async (req, res) => {
  const { modulos } = req.body; // array de strings: ['clientes', 'produtos']
  const eid = req.params.empresa_id;

  if (!Array.isArray(modulos)) return res.status(400).json({ erro: 'modulos deve ser um array' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Remove todos os módulos atuais
    await client.query('DELETE FROM modulos_empresa WHERE empresa_id = $1', [eid]);
    // Insere os novos
    for (const modulo of modulos) {
      await client.query(
        'INSERT INTO modulos_empresa (empresa_id, modulo, ativo) VALUES ($1, $2, true)',
        [eid, modulo]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true, modulos });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ erro: err.message });
  } finally { client.release(); }
});

module.exports = router;
module.exports.MODULOS_DISPONIVEIS = MODULOS_DISPONIVEIS;