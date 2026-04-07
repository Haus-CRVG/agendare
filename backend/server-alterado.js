require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { pool, initDB } = require('./db');

const app  = express();
const PORT = process.env.PORT || 3002;

app.use(cors({ origin: '*' }));
app.use(express.json());

// ── Servir o frontend estático ────────────────────────────
// Os arquivos HTML/CSS/JS ficam em ../frontend/
app.use(express.static(path.join(__dirname, '../frontend')));

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

app.get('/api/health', (_, res) => res.json({ ok: true, sistema: 'Agendare' }));

// ── Fallback: qualquer rota não-API serve o index.html ────
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
  }
});

pool.connect()
  .then(async (client) => {
    client.release();
    await initDB();
    app.listen(PORT, () => console.log(`✅ Agendare rodando na porta ${PORT}`));
  })
  .catch(err => {
    console.error('❌ Erro ao conectar ao banco:', err.message);
    process.exit(1);
  });
