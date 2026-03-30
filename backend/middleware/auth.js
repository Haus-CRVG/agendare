const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { pool } = require('../db');

// GET /api/auth/empresa/:doc — busca empresa por CNPJ ou CPF
router.get('/empresa/:doc', async (req, res) => {
  const digits = req.params.doc.replace(/\D/g, '');
  if (!digits || (digits.length !== 11 && digits.length !== 14)) {
    return res.json({ encontrado: false });
  }
  try {
    const result = await pool.query(
      `SELECT id, nome_fantasia, status, slug, cor_primaria, logo_url
       FROM empresas
       WHERE REGEXP_REPLACE(cnpj, '[^0-9]', '', 'g') = $1
         AND slug != 'sistema'
       LIMIT 1`,
      [digits]
    );
    if (!result.rows.length) return res.json({ encontrado: false });

    const e = result.rows[0];
    if (e.status !== 'ativo') {
      return res.json({ encontrado: true, bloqueado: true, motivo: e.status });
    }
    res.json({
      encontrado: true, bloqueado: false,
      id: e.id, nome: e.nome_fantasia,
      slug: e.slug, cor: e.cor_primaria, logo: e.logo_url
    });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, senha, empresa_id } = req.body;
  if (!email || !senha) return res.status(400).json({ erro: 'E-mail e senha obrigatórios' });

  try {
    let query, params;

    if (empresa_id) {
      // Login normal: usuário de uma empresa específica
      query = `SELECT u.*, e.nome_fantasia AS empresa_nome, e.slug, e.cor_primaria
               FROM usuarios u
               JOIN empresas e ON u.empresa_id = e.id
               WHERE u.email = $1 AND u.empresa_id = $2 AND u.ativo = true`;
      params = [email, empresa_id];
    } else {
      // Login sem empresa = superadmin
      query = `SELECT u.*, e.nome_fantasia AS empresa_nome, e.slug, e.cor_primaria
               FROM usuarios u
               LEFT JOIN empresas e ON u.empresa_id = e.id
               WHERE u.email = $1 AND u.perfil = 'superadmin' AND u.ativo = true`;
      params = [email];
    }

    const r = await pool.query(query, params);
    if (!r.rows.length) return res.status(401).json({ erro: 'Credenciais inválidas' });

    const u = r.rows[0];
    if (!await bcrypt.compare(senha, u.senha))
      return res.status(401).json({ erro: 'Credenciais inválidas' });

    const token = jwt.sign(
      { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil,
        empresa_id: u.empresa_id, empresa_nome: u.empresa_nome, slug: u.slug },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      usuario: {
        id: u.id, nome: u.nome, email: u.email, perfil: u.perfil,
        empresa_id: u.empresa_id, empresa_nome: u.empresa_nome,
        slug: u.slug, cor_primaria: u.cor_primaria
      }
    });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

module.exports = router;
