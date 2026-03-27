require('dotenv').config();
const { pool } = require('../db');
const bcrypt = require('bcryptjs');

async function criarSuperAdmin() {
  try {
    // Cria empresa padrão do sistema
    const emp = await pool.query(
      `INSERT INTO empresas (cnpj, nome_fantasia, email, slug)
   VALUES ('00000000000000', 'Sistema Agendare', 'haus.haus@gmail.com', 'sistema')
   ON CONFLICT (cnpj) DO NOTHING RETURNING id`
    );

    let empresa_id = emp.rows[0]?.id;
    if (!empresa_id) {
      const r = await pool.query(`SELECT id FROM empresas WHERE cnpj = '00000000000000'`);
      empresa_id = r.rows[0].id;
    }

    const hash = await bcrypt.hash('haus1234', 10);
    await pool.query(
      `INSERT INTO usuarios (empresa_id, nome, email, senha, perfil)
   VALUES ($1, 'Super Admin', 'haus.haus@gmail.com', $2, 'superadmin')
   ON CONFLICT (email) DO NOTHING`,
      [empresa_id, hash]
    );

    console.log('✅ Super Admin criado!');
    console.log('   E-mail : haus.haus@gmail.com');
    console.log('   Senha  : haus1234');
    console.log('   ⚠️  Troque a senha após o primeiro login!');
  } catch (err) {
    console.error('❌ Erro:', err.message);
  } finally {
    process.exit();
  }
}

criarSuperAdmin();