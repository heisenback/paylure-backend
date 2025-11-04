app.enableCors({
  origin: [
    'https://paylure.com.br',
    'https://www.paylure.com.br',
    'https://app.paylure.com.br',
    'https://api.paylure.com.br',
    'https://paylure.vercel.app',   // 👈 FRONT Vercel
  ],
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
  ],
  credentials: true,
  preflightContinue: false, // Nest responde o OPTIONS automaticamente
  optionsSuccessStatus: 204,
});
