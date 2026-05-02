require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { pool, initDB } = require('./db');

const app  = express();
const PORT = process.env.PORT || 3002;

app.use(cors({ origin: '*' }));
app.use(express.json());

// ── Rotas da API ──────────────────────────────────────────
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/empresas',      require('./routes/empresas'));
app.use('/api/usuarios',      require('./routes/usuarios'));
app.use('/api/servicos',      require('./routes/servicos'));
app.use('/api/profissionais', require('./routes/profissionais'));
app.use('/api/agendamentos',  require('./routes/agendamentos'));
app.use('/api/notificacoes',  require('./routes/notificacoes'));
app.use('/api/participantes', require('./routes/participantes'));
app.use('/api/public',        require('./routes/public'));
app.use('/api/sso',           require('./routes/sso'));
app.use('/api/modulos',       require('./routes/modulos'));
app.use('/api/clientes',      require('./routes/clientes'));

app.get('/api/health', (_, res) => res.json({ ok: true, sistema: 'Agendare' }));

app.use((req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada' });
});

pool.connect()
  .then(async (client) => {
    client.release();
    await initDB();
    app.listen(PORT, () => console.log(`✅ Agendare Backend rodando na porta ${PORT}`));
  })
  .catch(err => {
    console.error('❌ Erro ao conectar ao banco:', err.message);
    process.exit(1);
  });