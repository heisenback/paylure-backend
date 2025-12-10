// src/app.controller.ts
import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class AppController {
  // Injetando PrismaService no construtor para poder acessar o banco
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  health() {
    return { ok: true, ts: new Date().toISOString() };
  }

  // ==============================================
  // 🔓 ROTA PÚBLICA PARA O MENU DOS MEMBROS
  // ==============================================
  @Get('feature-flags')
  async getPublicFeatureFlags() {
    try {
        // Tenta buscar as configurações no banco (tabela SystemSetting)
        // Se a tabela tiver outro nome no seu banco, altere aqui.
        const setting = await this.prisma.systemSetting.findUnique({ where: { key: 'feature_flags' } });
        
        // Se encontrar, devolve o JSON. Se não, devolve objeto vazio.
        const flags = setting ? JSON.parse(setting.value) : {};
        return { flags };
    } catch (e) {
        // Em caso de erro (ex: tabela não existe), devolve vazio para não travar o frontend
        return { flags: {} };
    }
  }
}