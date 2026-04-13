const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const auth = require('../middleware/auth');
const crypto = require('crypto');
const { enviarConfirmacao, enviarCancelamento, enviarNotificacaoProfissional } = require('../services/mailer');

// ── GET /api/agendamentos — lista da empresa ──────────────
router.get('/', auth(), async (req, res) => {
  const eid = req.usuario.empresa_id;
  const { inicio, fim, profissional_id, status } = req.query;
  try {
    let where = ['a.empresa_id = $1'];
    let params = [eid];
    let idx = 2;
    if (inicio) { where.push(`a.data_inicio >= $${idx++}`); params.push(inicio); }
    if (fim)    { where.push(`a.data_inicio <= $${idx++}`); params.push(fim); }
    if (profissional_id) { where.push(`a.profissional_id = $${idx++}`); params.push(profissional_id); }
    if (status) { where.push(`a.status = $${idx++}`); params.push(status); }
    const result = await pool.query(`
      SELECT a.*, u.nome as profissional_nome, s.nome as servico_nome, s.cor as servico_cor, s.duracao_minutos
      FROM agendamentos a
      LEFT JOIN usuarios u ON a.profissional_id = u.id
      LEFT JOIN servicos s ON a.servico_id = s.id
      WHERE ${where.join(' AND ')}
      ORDER BY a.data_inicio ASC`, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// ── GET /api/agendamentos/horarios-disponiveis ────────────
router.get('/horarios-disponiveis', async (req, res) => {
  const { empresa_id, profissional_id, servico_id, data } = req.query;
  if (!empresa_id || !profissional_id || !servico_id || !data)
    return res.status(400).json({ erro: 'Parâmetros obrigatórios: empresa_id, profissional_id, servico_id, data' });
  try {
    const svc = await pool.query(`SELECT duracao_minutos FROM servicos WHERE id = $1`, [servico_id]);
    if (!svc.rows.length) return res.status(404).json({ erro: 'Serviço não encontrado' });
    const duracao = svc.rows[0].duracao_minutos;

    const cfg = await pool.query(`SELECT * FROM configuracoes WHERE empresa_id = $1`, [empresa_id]);
    const intervalo = cfg.rows[0]?.intervalo_agenda_minutos || 30;

    const dataObj = new Date(data + 'T00:00:00-03:00');
    const diaSemana = dataObj.getDay();

    const disp = await pool.query(
      `SELECT hora_inicio, hora_fim FROM disponibilidade
       WHERE profissional_id = $1 AND dia_semana = $2 AND ativo = true`,
      [profissional_id, diaSemana]
    );
    if (!disp.rows.length) return res.json({ horarios: [] });

    const agExist = await pool.query(
      `SELECT data_inicio, data_fim FROM agendamentos
       WHERE profissional_id = $1 AND status NOT IN ('cancelado')
       AND DATE(data_inicio AT TIME ZONE 'America/Sao_Paulo') = $2`,
      [profissional_id, data]
    );

    const bloq = await pool.query(
      `SELECT data_inicio, data_fim FROM bloqueios
       WHERE profissional_id = $1
       AND data_inicio::date <= $2 AND data_fim::date >= $2`,
      [profissional_id, data]
    );

    const ocupados = [...agExist.rows, ...bloq.rows];
    const horarios = [];

    for (const slot of disp.rows) {
      const [hIni, mIni] = slot.hora_inicio.split(':').map(Number);
      const [hFim, mFim] = slot.hora_fim.split(':').map(Number);
      let cur = hIni * 60 + mIni;
      const fim = hFim * 60 + mFim;

      while (cur + duracao <= fim) {
        const slotIni = new Date(`${data}T${String(Math.floor(cur/60)).padStart(2,'0')}:${String(cur%60).padStart(2,'0')}:00-03:00`);
        const slotFim = new Date(slotIni.getTime() + duracao * 60000);
        const conflito = ocupados.some(oc => {
          const ocIni = new Date(oc.data_inicio);
          const ocFim = new Date(oc.data_fim);
          return slotIni < ocFim && slotFim > ocIni;
        });
        if (!conflito) {
          horarios.push({
            hora: `${String(Math.floor(cur/60)).padStart(2,'0')}:${String(cur%60).padStart(2,'0')}`,
            data_inicio: slotIni.toISOString(),
            data_fim: slotFim.toISOString(),
          });
        }
        cur += intervalo;
      }
    }
    res.json({ horarios });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// ── POST /api/agendamentos — criar ────────────────────────
router.post('/', auth(), async (req, res) => {
  const {
    empresa_id, profissional_id, servico_id,
    cliente_nome, cliente_email, cliente_telefone,
    data_inicio, data_fim, observacoes, dia_todo, email_convidado
  } = req.body;

  if (!empresa_id || !profissional_id || !cliente_nome || !data_inicio || !data_fim)
    return res.status(400).json({ erro: 'Campos obrigatórios faltando' });

  try {
    const token_cancelamento = crypto.randomBytes(32).toString('hex');
    const result = await pool.query(`
      INSERT INTO agendamentos (
        empresa_id, profissional_id, servico_id, cliente_nome,
        cliente_email, cliente_telefone, data_inicio, data_fim,
        observacoes, token_cancelamento, dia_todo
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        empresa_id, profissional_id, servico_id || null, cliente_nome,
        cliente_email || null, cliente_telefone || null,
        data_inicio, data_fim, observacoes || null,
        token_cancelamento, dia_todo || false
      ]
    );
    const ag = result.rows[0];

    // Notificação interna
    await pool.query(
      `INSERT INTO notificacoes (usuario_id, titulo, mensagem) VALUES ($1,$2,$3)`,
      [profissional_id,
       `Novo compromisso: ${cliente_nome}`,
       `${new Date(data_inicio).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}`]
    ).catch(() => {});

    // E-mail para convidado externo
    if (email_convidado) {
      const profResult = await pool.query(`SELECT nome FROM usuarios WHERE id = $1`, [profissional_id]).catch(() => ({ rows: [] }));
      const nomeProf = profResult.rows[0]?.nome || 'Equipe';
      const { enviarConviteExterno } = require('../services/mailer');
      enviarConviteExterno({
        para: email_convidado,
        titulo: cliente_nome,
        organizador: nomeProf,
        dataInicio: data_inicio,
        dataFim: data_fim,
        observacoes: observacoes || null
      }).catch(e => console.error('❌ E-mail convidado:', e.message));
    }

    res.status(201).json({ ...ag, token_cancelamento });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// ── PATCH /api/agendamentos/:id — atualizar status ────────
router.patch('/:id', auth(), async (req, res) => {
  const { status, observacoes } = req.body;
  const usuarioId = req.usuario.id;
  const perfil    = req.usuario.perfil;
  const eid       = req.usuario.empresa_id;

  try {
    // Verifica se o agendamento existe e pertence à empresa
    const check = await pool.query(
      `SELECT profissional_id FROM agendamentos WHERE id = $1 AND empresa_id = $2`,
      [req.params.id, eid]
    );
    if (!check.rows.length) return res.status(404).json({ erro: 'Agendamento não encontrado' });

    // Analista só pode editar o próprio agendamento
    if (perfil !== 'admin' && perfil !== 'superadmin') {
      if (check.rows[0].profissional_id !== usuarioId) {
        return res.status(403).json({ erro: 'Você só pode editar seus próprios compromissos' });
      }
    }

    const result = await pool.query(
      `UPDATE agendamentos SET status=$1, observacoes=COALESCE($2,observacoes)
       WHERE id=$3 AND empresa_id=$4 RETURNING *`,
      [status, observacoes, req.params.id, eid]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// ── POST /api/agendamentos/cancelar/:token ────────────────
router.post('/cancelar/:token', async (req, res) => {
  const { motivo } = req.body;
  try {
    const result = await pool.query(
      `UPDATE agendamentos SET status='cancelado', cancelado_em=NOW(), motivo_cancelamento=$1
       WHERE token_cancelamento=$2 AND status NOT IN ('cancelado','concluido') RETURNING *`,
      [motivo||null, req.params.token]
    );
    if (!result.rows.length)
      return res.status(404).json({ erro: 'Agendamento não encontrado ou já cancelado' });
    const ag = result.rows[0];
    if (ag.cliente_email) {
      const svc = await pool.query(`SELECT nome FROM servicos WHERE id = $1`, [ag.servico_id]);
      enviarCancelamento({ para: ag.cliente_email, nomeCliente: ag.cliente_nome,
        servico: svc.rows[0]?.nome, dataInicio: ag.data_inicio })
        .catch(e => console.error('❌ E-mail cancelamento:', e.message));
    }
    res.json({ ok: true, mensagem: 'Agendamento cancelado com sucesso' });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// ── GET /api/agendamentos/cancelar/:token ─────────────────
router.get('/cancelar/:token', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.*, s.nome as servico_nome, u.nome as profissional_nome
       FROM agendamentos a
       LEFT JOIN servicos s ON a.servico_id = s.id
       LEFT JOIN usuarios u ON a.profissional_id = u.id
       WHERE a.token_cancelamento = $1`,
      [req.params.token]
    );
    if (!result.rows.length) return res.status(404).json({ erro: 'Token inválido' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

module.exports = router;
