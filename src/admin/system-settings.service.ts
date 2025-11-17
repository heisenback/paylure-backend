// src/admin/system-settings.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SystemSettingsService {
  private readonly logger = new Logger(SystemSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Obtém configuração do sistema
   */
  async getSetting(key: string): Promise<string | null> {
    const setting = await this.prisma.systemSettings.findUnique({
      where: { key },
    });
    return setting?.value || null;
  }

  /**
   * Define configuração do sistema
   */
  async setSetting(key: string, value: string): Promise<void> {
    await this.prisma.systemSettings.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    this.logger.log(`✅ Configuração atualizada: ${key} = ${value}`);
  }

  /**
   * Obtém taxas globais de saque
   */
  async getWithdrawalFees(): Promise<{ percent: number; fixed: number }> {
    const percent = await this.getSetting('WITHDRAWAL_FEE_PERCENT');
    const fixed = await this.getSetting('WITHDRAWAL_FEE_FIXED');

    return {
      percent: percent ? parseFloat(percent) : 8.0, // Padrão: 8%
      fixed: fixed ? parseFloat(fixed) : 2.0,       // Padrão: R$ 2,00
    };
  }

  /**
   * Define taxas globais de saque
   */
  async setWithdrawalFees(percent: number, fixed: number): Promise<void> {
    await this.setSetting('WITHDRAWAL_FEE_PERCENT', percent.toString());
    await this.setSetting('WITHDRAWAL_FEE_FIXED', fixed.toString());
    this.logger.log(`💰 Taxas globais atualizadas: ${percent}% + R$ ${fixed}`);
  }
}