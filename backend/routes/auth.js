const jwt = require('jsonwebtoken');

function auth(perfisPermitidos = []) {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ erro: 'Token não fornecido' });
    }
    const token = header.split(' ')[1];
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.usuario = payload;

      // Se não passou lista de perfis, qualquer autenticado passa
      // Se passou lista, verifica se o perfil está nela
      // Superadmin sempre tem acesso a tudo
      if (perfisPermitidos.length > 0 &&
          payload.perfil !== 'superadmin' &&
          !perfisPermitidos.includes(payload.perfil)) {
        return res.status(403).json({ erro: 'Sem permissão' });
      }
      next();
    } catch {
      return res.status(401).json({ erro: 'Token inválido ou expirado' });
    }
  };
}

module.exports = auth;
