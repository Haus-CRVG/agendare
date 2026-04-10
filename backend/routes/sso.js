// routes/sso.js  — Backend do AGENDARE (versão completa com provisionamento)
// Mantém a rota /validar existente e adiciona /provisionar e /provisionar-usuario

const express  = require('express');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const { pool } = require('../db');
const router   = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'agendare_chave_secreta_2025';
const SSO_SECRET = process.env.SSO_SECRET || 'sso_chave_compartilhada_2025';

// ── Middleware: valida que a chamada vem do Implanta ──────
function autenticarImplanta(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ erro: 'Sem autorização' });
  try {
    const payload = jwt.verify(auth.replace('Bearer ', ''), SSO_SECRET);
    if (payload.sistema !== 'implanta') return res.status(403).json({ erro: 'Sistema não autorizado' });
    next();
  } catch {
    res.status(401).json({ erro: 'Token de integração inválido' });
  }
}

/**
 * POST /api/sso/validar
 * Valida token SSO e retorna JWT do Agendare (login automático).
 */
router.post('/validar', async (req, res) => {
  const { sso_token } = req.body;
  if (!sso_token) return res.status(400).json({ erro: 'Token SSO ausente' });

  let payload;
  try {
    payload = jwt.verify(sso_token, SSO_SECRET);
  } catch (e) {
    return res.status(401).json({ erro: 'Token SSO inválido ou expirado' });
  }

  const { email, cnpj } = payload;

  try {
    // Encontra empresa pelo CNPJ
    const empQ = await pool.query(
      `SELECT id, slug FROM empresas
       WHERE REGEXP_REPLACE(cnpj, '\\D', '', 'g') = $1 AND status = 'ativo'
       LIMIT 1`,
      [cnpj]
    );
    if (!empQ.rows.length) {
      return res.status(404).json({ erro: 'Empresa não encontrada no Agendare.' });
    }

    const empresa_id = empQ.rows[0].id;
    const slug       = empQ.rows[0].slug || '';

    // Busca usuário pelo e-mail + empresa
    const userQ = await pool.query(
      `SELECT id, nome, email, perfil, empresa_id
       FROM usuarios
       WHERE email = $1 AND empresa_id = $2 AND ativo = true
       LIMIT 1`,
      [email, empresa_id]
    );
    if (!userQ.rows.length) {
      return res.status(404).json({ erro: 'Usuário não encontrado no Agendare.' });
    }

    const user = userQ.rows[0];
    const token = jwt.sign(
      { id: user.id, email: user.email, perfil: user.perfil, empresa_id: user.empresa_id },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      usuario: { id: user.id, nome: user.nome, email: user.email, perfil: user.perfil, empresa_id: user.empresa_id, slug }
    });

  } catch (err) {
    console.error('[SSO] Erro ao validar:', err.message);
    res.status(500).json({ erro: 'Erro interno ao validar SSO' });
  }
});

/**
 * POST /api/sso/provisionar
 * Cria empresa + admin no Agendare automaticamente quando o Implanta
 * cadastra uma nova empresa com tem_agendare = true.
 */
router.post('/provisionar', autenticarImplanta, async (req, res) => {
  const { cnpj, nome_fantasia, email, telefone, admin_nome, admin_email, admin_senha } = req.body;

  if (!cnpj || !nome_fantasia || !admin_nome || !admin_email || !admin_senha) {
    return res.status(400).json({ erro: 'Dados incompletos para provisionamento' });
  }

  // Gera slug a partir do nome: "Xuxu Estofado" → "xuxu-estofado"
  const slug = nome_fantasia
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

  const cnpjLimpo = cnpj.replace(/\D/g, '');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verifica se empresa já existe (evita duplicata)
    const jaExiste = await client.query(
      `SELECT id FROM empresas WHERE REGEXP_REPLACE(cnpj,'\\D','','g') = $1`,
      [cnpjLimpo]
    );
    if (jaExiste.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ erro: 'Empresa já cadastrada no Agendare', empresa_id: jaExiste.rows[0].id });
    }

    // Gera slug único se necessário
    let slugFinal = slug;
    const slugCheck = await client.query('SELECT id FROM empresas WHERE slug = $1', [slug]);
    if (slugCheck.rows.length) slugFinal = `${slug}-${cnpjLimpo.slice(-4)}`;

    // Cria empresa
    const empResult = await client.query(
      `INSERT INTO empresas (cnpj, nome_fantasia, email, telefone, slug, cor_primaria, status)
       VALUES ($1,$2,$3,$4,$5,'#0d9488','ativo') RETURNING *`,
      [cnpjLimpo, nome_fantasia, email||null, telefone||null, slugFinal]
    );
    const empresa = empResult.rows[0];

    // Cria configurações padrão
    await client.query(
      'INSERT INTO configuracoes (empresa_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [empresa.id]
    );

    // Cria o admin
    const hash = await bcrypt.hash(admin_senha, 10);
    await client.query(
      `INSERT INTO usuarios (empresa_id, nome, email, senha, perfil, ativo)
       VALUES ($1,$2,$3,$4,'admin',true)`,
      [empresa.id, admin_nome, admin_email, hash]
    );

    await client.query('COMMIT');
    res.status(201).json({ ok: true, empresa_id: empresa.id, slug: slugFinal });

  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(400).json({ erro: 'CNPJ, slug ou e-mail já cadastrado no Agendare' });
    console.error('[SSO] Erro ao provisionar:', err.message);
    res.status(500).json({ erro: 'Erro ao criar empresa no Agendare: ' + err.message });
  } finally { client.release(); }
});

/**
 * POST /api/sso/provisionar-usuario
 * Cria um usuário no Agendare quando o Implanta replica o cadastro.
 */
router.post('/provisionar-usuario', autenticarImplanta, async (req, res) => {
  const { cnpj, nome, email, senha, telefone, perfil } = req.body;

  if (!cnpj || !nome || !email || !senha) {
    return res.status(400).json({ erro: 'Dados incompletos' });
  }

  const cnpjLimpo = cnpj.replace(/\D/g, '');

  try {
    // Encontra a empresa pelo CNPJ
    const empQ = await pool.query(
      `SELECT id FROM empresas WHERE REGEXP_REPLACE(cnpj,'\\D','','g') = $1 AND status = 'ativo'`,
      [cnpjLimpo]
    );
    if (!empQ.rows.length) {
      return res.status(404).json({ erro: 'Empresa não encontrada no Agendare. Crie a empresa primeiro.' });
    }

    const empresa_id = empQ.rows[0].id;

    // Verifica se usuário já existe
    const jaExiste = await pool.query(
      'SELECT id FROM usuarios WHERE email = $1 AND empresa_id = $2',
      [email, empresa_id]
    );
    if (jaExiste.rows.length) {
      return res.status(409).json({ erro: 'Usuário já cadastrado no Agendare' });
    }

    // Mapeia perfil do Implanta → Agendare
    // Implanta: 'admin' | 'analista'   →   Agendare: 'admin' | 'profissional'
    const perfilAgendare = perfil === 'admin' ? 'admin' : 'profissional';

    const hash = await bcrypt.hash(senha, 10);
    const result = await pool.query(
      `INSERT INTO usuarios (empresa_id, nome, email, senha, perfil, ativo)
       VALUES ($1,$2,$3,$4,$5,true) RETURNING id, nome, email, perfil`,
      [empresa_id, nome, email, hash, perfilAgendare]
    );

    res.status(201).json({ ok: true, usuario: result.rows[0] });

  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ erro: 'E-mail já cadastrado no Agendare' });
    console.error('[SSO] Erro ao provisionar usuário:', err.message);
    res.status(500).json({ erro: 'Erro ao criar usuário no Agendare: ' + err.message });
  }
});

module.exports = router;
