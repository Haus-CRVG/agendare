const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');
const autenticar = require('../middleware/auth');
const { enviarConviteParticipante } = require('../services/mailer');

// GET /api/participantes/:agendamento_id — lista participantes
router.get('/:agendamento_id', autenticar(), async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT ap.*, 
             u.nome AS profissional_nome, u.email AS profissional_email
      FROM agendamento_participantes ap
      LEFT JOIN usuarios u ON ap.profissional_id = u.id
      WHERE ap.agendamento_id = $1
      ORDER BY ap.criado_em ASC`,
      [req.params.agendamento_id]
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// POST /api/participantes — adiciona participante
router.post('/', autenticar(), async (req, res) => {
  const { agendamento_id, profissional_id, nome_externo, email_externo } = req.body;

  if (!profissional_id && (!nome_externo || !email_externo)) {
    return res.status(400).json({ erro: 'Informe o profissional ou nome+e-mail do participante externo' });
  }

  try {
    // Busca dados do agendamento para o e-mail
    const ag = await pool.query(`
      SELECT a.*, s.nome AS servico_nome, e.nome_fantasia AS empresa_nome
      FROM agendamentos a
      JOIN servicos s ON a.servico_id = s.id
      JOIN empresas e ON a.empresa_id = e.id
      WHERE a.id = $1`, [agendamento_id]
    );
    if (!ag.rows.length) return res.status(404).json({ erro: 'Agendamento não encontrado' });

    const token = uuidv4();
    const r = await pool.query(`
      INSERT INTO agendamento_participantes 
        (agendamento_id, profissional_id, nome_externo, email_externo, token_resposta)
      VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [agendamento_id, profissional_id || null, nome_externo || null, email_externo || null, token]
    );
    const participante = r.rows[0];

    // Busca nome e e-mail do participante
    let nomeP = nome_externo, emailP = email_externo;
    if (profissional_id) {
      const u = await pool.query('SELECT nome, email FROM usuarios WHERE id=$1', [profissional_id]);
      if (u.rows.length) { nomeP = u.rows[0].nome; emailP = u.rows[0].email; }
    }

    // Envia e-mail de convite
    if (emailP) {
      await enviarConviteParticipante({
        nome: nomeP,
        email: emailP,
        agendamento: ag.rows[0],
        token
      });
    }

    res.status(201).json(participante);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// GET /api/participantes/responder/:token — página de resposta (público)
router.get('/responder/:token', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT ap.*, 
             a.data_inicio, a.data_fim, a.cliente_nome, a.observacoes,
             s.nome AS servico_nome,
             e.nome_fantasia AS empresa_nome,
             u.nome AS profissional_nome
      FROM agendamento_participantes ap
      JOIN agendamentos a ON ap.agendamento_id = a.id
      JOIN servicos s ON a.servico_id = s.id
      JOIN empresas e ON a.empresa_id = e.id
      LEFT JOIN usuarios u ON ap.profissional_id = u.id
      WHERE ap.token_resposta = $1`,
      [req.params.token]
    );
    if (!r.rows.length) return res.status(404).json({ erro: 'Convite não encontrado' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// PATCH /api/participantes/responder/:token — confirma ou cancela (público)
router.patch('/responder/:token', async (req, res) => {
  const { status } = req.body;
  if (!['confirmado','cancelado'].includes(status))
    return res.status(400).json({ erro: 'Status inválido' });

  try {
    const r = await pool.query(`
      UPDATE agendamento_participantes 
      SET status=$1, respondido_em=NOW()
      WHERE token_resposta=$2 AND status='pendente'
      RETURNING *`,
      [status, req.params.token]
    );
    if (!r.rows.length) return res.status(404).json({ erro: 'Convite não encontrado ou já respondido' });
    res.json({ mensagem: `Presença ${status} com sucesso!` });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// DELETE /api/participantes/:id — remove participante
router.delete('/:id', autenticar(), async (req, res) => {
  try {
    await pool.query('DELETE FROM agendamento_participantes WHERE id=$1', [req.params.id]);
    res.json({ mensagem: 'Participante removido' });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

module.exports = router;