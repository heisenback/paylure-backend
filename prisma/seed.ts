// prisma/seed.ts
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
// Importa o módulo crypto nativo do Node.js
import * as crypto from 'crypto'; 

const prisma = new PrismaClient();

// Função para gerar uma chave de API segura
function generateApiKey(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

async function main() {
  // ATENÇÃO: Esta é a senha para o login admin@paylure.com
  const hashedPassword = await bcrypt.hash('secreto123', 10); 
  
  // --- Geração das chaves de API ---
  const adminApiKey = generateApiKey(16); // Chave pública menor, fácil de visualizar
  const adminApiSecret = generateApiKey(32); // Chave secreta mais longa, mais segura
  // ----------------------------------

  const defaultUser = await prisma.user.upsert({
    where: { email: 'admin@paylure.com' },
    update: {
      // Garante que as chaves sejam atualizadas se o script rodar novamente
      apiKey: adminApiKey,
      apiSecret: adminApiSecret,
    }, 
    create: {
      name: 'Admin Paylure',
      email: 'admin@paylure.com',
      password: hashedPassword,
      document: '11122233344',
      balance: 100000, // R$ 1.000,00 em centavos (para testes de saque)
      // --- Adicionando as chaves no momento da criação ---
      apiKey: adminApiKey,
      apiSecret: adminApiSecret,
    },
  });

  console.log(`Usuário padrão criado com sucesso: ${defaultUser.email}`);
  console.log(`\n🔑 Chaves de API do Admin:`);
  console.log(`- API Key (Pública): ${adminApiKey}`);
  console.log(`- API Secret (Secreta): ${adminApiSecret}\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    // 🚨 CORREÇÃO FINAL AQUI: Usando o método correto $disconnect()
    await prisma.$disconnect(); 
  });