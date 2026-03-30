const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : { host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD }
);

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS empresas (
        id SERIAL PRIMARY KEY,
        cnpj VARCHAR(20) UNIQUE NOT NULL,
        nome_fantasia VARCHAR(200) NOT NULL,
        email VARCHAR(100),
        telefone VARCHAR(20),
        status VARCHAR(20) DEFAULT 'ativo' CHECK (status IN ('ativo','suspenso','cancelado')),
        slug VARCHAR(100) UNIQUE,
        logo_url TEXT,
        cor_primaria VARCHAR(10) DEFAULT '#0d9488',
        criado_em TIMESTAMP DEFAULT NOW(),
        vencimento DATE
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS super_admins (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        senha VARCHAR(255) NOT NULL,
        criado_em TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        empresa_id INTEGER REFERENCES empresas(id) ON DELETE CASCADE,
        nome VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        telefone VARCHAR(20),
        senha VARCHAR(255) NOT NULL,
        perfil VARCHAR(20) DEFAULT 'profissional' CHECK (perfil IN ('admin','profissional','superadmin')),
        ativo BOOLEAN DEFAULT true,
        avatar_url TEXT,
        criado_em TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS servicos (
        id SERIAL PRIMARY KEY,
        empresa_id INTEGER REFERENCES empresas(id) ON DELETE CASCADE,
        nome VARCHAR(200) NOT NULL,
        descricao TEXT,
        duracao_minutos INTEGER NOT NULL DEFAULT 60,
        preco DECIMAL(10,2),
        cor VARCHAR(10) DEFAULT '#0d9488',
        ativo BOOLEAN DEFAULT true,
        criado_em TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS profissional_servicos (
        profissional_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
        servico_id INTEGER REFERENCES servicos(id) ON DELETE CASCADE,
        PRIMARY KEY (profissional_id, servico_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS disponibilidade (
        id SERIAL PRIMARY KEY,
        profissional_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
        dia_semana INTEGER NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
        hora_inicio TIME NOT NULL,
        hora_fim TIME NOT NULL,
        ativo BOOLEAN DEFAULT true
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bloqueios (
        id SERIAL PRIMARY KEY,
        profissional_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
        data_inicio TIMESTAMP NOT NULL,
        data_fim TIMESTAMP NOT NULL,
        motivo VARCHAR(200)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS agendamentos (
        id SERIAL PRIMARY KEY,
        empresa_id INTEGER REFERENCES empresas(id) ON DELETE CASCADE,
        profissional_id INTEGER REFERENCES usuarios(id),
        servico_id INTEGER REFERENCES servicos(id),
        cliente_nome VARCHAR(200) NOT NULL,
        cliente_email VARCHAR(100),
        cliente_telefone VARCHAR(20),
        data_inicio TIMESTAMP NOT NULL,
        data_fim TIMESTAMP NOT NULL,
        status VARCHAR(20) DEFAULT 'confirmado' CHECK (status IN ('pendente','confirmado','cancelado','concluido','faltou')),
        observacoes TEXT,
        token_cancelamento VARCHAR(100) UNIQUE,
        cancelado_em TIMESTAMP,
        motivo_cancelamento TEXT,
        criado_em TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS notificacoes (
        id SERIAL PRIMARY KEY,
        usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
        titulo VARCHAR(200) NOT NULL,
        mensagem TEXT NOT NULL,
        lida BOOLEAN DEFAULT false,
        criado_em TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS configuracoes (
        empresa_id INTEGER PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
        fuso_horario VARCHAR(50) DEFAULT 'America/Sao_Paulo',
        antecedencia_minima_horas INTEGER DEFAULT 1,
        antecedencia_maxima_dias INTEGER DEFAULT 60,
        intervalo_agenda_minutos INTEGER DEFAULT 30,
        permite_cancelamento BOOLEAN DEFAULT true,
        prazo_cancelamento_horas INTEGER DEFAULT 24,
        mensagem_confirmacao TEXT,
        atualizado_em TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS agendamento_participantes (
        id               SERIAL PRIMARY KEY,
        agendamento_id   INTEGER REFERENCES agendamentos(id) ON DELETE CASCADE,
        profissional_id  INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
        nome_externo     VARCHAR(200),
        email_externo    VARCHAR(100),
        status           VARCHAR(20) DEFAULT 'pendente'
                         CHECK (status IN ('pendente','confirmado','cancelado')),
        token_resposta   VARCHAR(100) UNIQUE,
        respondido_em    TIMESTAMP,
        criado_em        TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log('✅ Banco Agendare inicializado com sucesso');
  } catch (err) {
    console.error('❌ Erro ao inicializar banco:', err.message);
    throw err;
  }
}

pool.connect()
  .then(() => console.log('✅ Conectado ao PostgreSQL'))
  .catch(err => console.error('❌ Erro ao conectar ao banco:', err.message));

module.exports = { pool, initDB };
