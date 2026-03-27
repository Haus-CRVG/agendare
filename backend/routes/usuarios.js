const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const { pool } = require('../db');
const autenticar = require('../middleware/auth');

router.get('/', autenticar(['superadmin', 'admin']), async (req, res) => {
  const empresa_id = req.usuario.perfil === 'superadmin'
    ? req.query.empresa_id : req.usuario.empresa_id;
  try {
    const r = await pool.query(
      `SELECT id,nome,email,perfil,telefone,ativo,criado_em
       FROM usuarios WHERE empresa_id=$1 ORDER BY nome`,
      [empresa_id]
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

router.post('/', autenticar(['superadmin', 'admin']), async (req, res) => {
  const { nome, email, senha, perfil, telefone } = req.body;
  try {
    const hash = await bcrypt.hash(senha, 10);
    const r = await pool.query(
      `INSERT INTO usuarios (empresa_id,nome,email,senha,perfil,telefone)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,nome,email,perfil`,
      [req.usuario.empresa_id, nome, email, hash, perfil||'admin', telefone]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ erro: 'E-mail já cadastrado' });
    res.status(500).json({ erro: err.message });
  }
});

router.patch('/:id', autenticar(['superadmin', 'admin']), async (req, res) => {
  const { nome, email, telefone, perfil, ativo } = req.body;
  try {
    await pool.query(
      `UPDATE usuarios SET nome=$1,email=$2,telefone=$3,
       perfil=COALESCE($4,perfil),ativo=COALESCE($5,ativo) WHERE id=$6`,
      [nome, email, telefone, perfil, ativo, req.params.id]
    );
    res.json({ mensagem: 'Atualizado' });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

router.patch('/:id/senha', autenticar(['superadmin', 'admin']), async (req, res) => {
  const { senha_atual, nova_senha } = req.body;
  try {
    const r = await pool.query('SELECT senha FROM usuarios WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ erro: 'Usuário não encontrado' });
    if (!await bcrypt.compare(senha_atual, r.rows[0].senha))
      return res.status(400).json({ erro: 'Senha atual incorreta' });
    const hash = await bcrypt.hash(nova_senha, 10);
    await pool.query('UPDATE usuarios SET senha=$1 WHERE id=$2', [hash, req.params.id]);
    res.json({ mensagem: 'Senha alterada' });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

module.exports = router;