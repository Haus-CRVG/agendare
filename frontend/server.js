const express = require('express');
const path    = require('path');
const app     = express();
const PORT    = process.env.PORT || 8080;

// Serve todos os arquivos estáticos da pasta frontend
app.use(express.static(path.join(__dirname)));

// Rota raiz → dashboard (se já logado) ou index
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Fallback para qualquer rota não encontrada → index
app.get('*', (req, res) => {
  const file = req.path.replace('/', '');
  const fullPath = path.join(__dirname, file);
  res.sendFile(fullPath, err => {
    if (err) res.sendFile(path.join(__dirname, 'index.html'));
  });
});

app.listen(PORT, () => console.log(`✅ Agendare Frontend rodando na porta ${PORT}`));
