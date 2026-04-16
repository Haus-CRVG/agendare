const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const { pool } = require('../db');
const auth = require('../middleware/auth');

function superAdminOnly(req, res, next) {
  if (req.usuario.perfil !== 'superadmin') return res.status(403).json({ erro: 'Apenas super admin' });
  next();
}

// GET /api/empresas — lista todas (super admin)
router.get('/', auth(['superadmin']), superAdminOnly, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*, COUNT(u.id) AS total_usuarios
      FROM empresas e
      LEFT JOIN usuarios u ON u.empresa_id = e.id
      GROUP BY e.id ORDER BY e.criado_em DESC
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// GET /api/empresas/minha — dados da empresa logada
router.get('/minha', auth(), async (req, res) => {
  if (!req.usuario.empresa_id) return res.status(404).json({ erro: 'Sem empresa vinculada' });
  try {
    const result = await pool.query('SELECT * FROM empresas WHERE id = $1', [req.usuario.empresa_id]);
    if (!result.rows.length) return res.status(404).json({ erro: 'Empresa não encontrada' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// GET /api/empresas/slug/:slug — dados públicos (link de agendamento)
router.get('/slug/:slug', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, nome_fantasia, slug, cor_primaria, logo_url, status
       FROM empresas WHERE slug = $1`,
      [req.params.slug]
    );
    if (!result.rows.length) return res.status(404).json({ erro: 'Empresa não encontrada' });
    const e = result.rows[0];
    if (e.status !== 'ativo') return res.status(403).json({ erro: 'Empresa inativa' });
    res.json(e);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// POST /api/empresas — criar empresa + admin numa única chamada
router.post('/', auth(['superadmin']), superAdminOnly, async (req, res) => {
  const {
    cnpj, nome_fantasia, email, telefone, slug, cor_primaria, vencimento,
    admin_nome, admin_email, admin_senha, imagem_fundo_url
  } = req.body;

  if (!cnpj || !nome_fantasia || !slug)
    return res.status(400).json({ erro: 'CNPJ, nome e slug são obrigatórios' });
  if (!admin_nome || !admin_email || !admin_senha)
    return res.status(400).json({ erro: 'Nome, e-mail e senha do administrador são obrigatórios' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Cria a empresa
    const empResult = await client.query(
      `INSERT INTO empresas (cnpj, nome_fantasia, email, telefone, slug, cor_primaria, vencimento, imagem_fundo_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [cnpj.replace(/\D/g,''), nome_fantasia, email||null, telefone||null,
       slug.toLowerCase().replace(/\s+/g,'-'), cor_primaria||'#0d9488', vencimento||null, imagem_fundo_url||null]
    );
    const empresa = empResult.rows[0];

    // Cria configurações padrão
    await client.query(
      'INSERT INTO configuracoes (empresa_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [empresa.id]
    );

    // Cria o admin da empresa
    const hash = await bcrypt.hash(admin_senha, 10);
    await client.query(
      `INSERT INTO usuarios (empresa_id, nome, email, senha, perfil)
       VALUES ($1,$2,$3,$4,'admin')`,
      [empresa.id, admin_nome, admin_email, hash]
    );

    await client.query('COMMIT');
    res.status(201).json(empresa);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(400).json({ erro: 'CNPJ, slug ou e-mail já cadastrado' });
    res.status(500).json({ erro: err.message });
  } finally { client.release(); }
});

// PATCH /api/empresas/:id — editar empresa
router.patch('/:id', auth(['superadmin']), superAdminOnly, async (req, res) => {
  const { cnpj, nome_fantasia, email, telefone, slug, cor_primaria, status, vencimento, imagem_fundo_url } = req.body;
  try {
    const result = await pool.query(`
      UPDATE empresas SET
        cnpj             = COALESCE($1, cnpj),
        nome_fantasia    = COALESCE($2, nome_fantasia),
        email            = COALESCE($3, email),
        telefone         = COALESCE($4, telefone),
        slug             = COALESCE($5, slug),
        cor_primaria     = COALESCE($6, cor_primaria),
        status           = COALESCE($7, status),
        vencimento       = COALESCE($8, vencimento),
        imagem_fundo_url = COALESCE($9, imagem_fundo_url)
      WHERE id = $10 RETURNING *`,
      [cnpj, nome_fantasia, email, telefone, slug?.toLowerCase(), cor_primaria, status, vencimento, imagem_fundo_url||null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ erro: 'Empresa não encontrada' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// GET /api/empresas/:id — busca uma empresa (super admin)
router.get('/:id', auth(['superadmin']), superAdminOnly, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM empresas WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ erro: 'Empresa não encontrada' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// GET /api/empresas/:id/usuarios
router.get('/:id/usuarios', auth(['superadmin']), superAdminOnly, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, nome, email, perfil, ativo, criado_em FROM usuarios WHERE empresa_id = $1 ORDER BY nome',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// POST /api/empresas/:id/usuarios — adiciona usuário à empresa
router.post('/:id/usuarios', auth(['superadmin']), superAdminOnly, async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { nome, email, senha, perfil } = req.body;
  if (!nome || !email || !senha) return res.status(400).json({ erro: 'Nome, e-mail e senha obrigatórios' });
  try {
    const hash = await bcrypt.hash(senha, 10);
    const result = await pool.query(
      `INSERT INTO usuarios (empresa_id, nome, email, senha, perfil)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, nome, email, perfil`,
      [req.params.id, nome, email, hash, perfil || 'admin']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ erro: 'E-mail já cadastrado' });
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;