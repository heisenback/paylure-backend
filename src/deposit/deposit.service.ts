// src/deposit/deposit.service.ts
import {
  Injectable,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { KeyclubService } from 'src/keyclub/keyclub.service';
import { CreateDepositDto } from './dto/create-deposit.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class DepositService {
  private readonly logger = new Logger(DepositService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keyclubService: KeyclubService,
  ) {}

  /**
   * Cria um novo depósito (PIX) para um Usuário/Seller.
   */
  async createDeposit(userId: string, dto: CreateDepositDto) {
    const amountAsAny = dto.amount;

    // 1. Encontrar o usuário logado
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        document: true,
      },
    });

    if (!user) {
      throw new ForbiddenException('Usuário não encontrado.');
    }

    // ✅ CORREÇÃO: Validação mais robusta do documento
    if (!user.document) {
      throw new ForbiddenException(
        'Seu perfil precisa ter um CPF/Documento cadastrado. Atualize seu perfil antes de fazer depósitos.',
      );
    }

    // Remove caracteres não numéricos para validar
    const documentNumbers = user.document.replace(/\D/g, '');
    
    if (documentNumbers.length < 11) {
      throw new ForbiddenException(
        'CPF/Documento inválido. O documento deve ter no mínimo 11 dígitos.',
      );
    }

    if (typeof amountAsAny !== 'number' || amountAsAny <= 0) {
      throw new BadRequestException('Valor de depósito inválido.');
    }

    const amountInBrl = amountAsAny / 100;
    const webhookToken = uuidv4();
    const externalId = `DEP-${user.id.substring(0, 8)}-${Date.now()}`;

    let pendingDeposit;
    try {
      // 2. Criar o registro do Depósito no banco como PENDING
      pendingDeposit = await this.prisma.deposit.create({
        data: {
          amountInCents: amountAsAny,
          status: 'PENDING',
          user: {
            connect: { id: user.id },
          },
          payerName: user.name || 'N/A',
          payerEmail: user.email,
          payerDocument: documentNumbers, // ✅ Usa documento sem formatação
          webhookToken: webhookToken,
          externalId: externalId,
          netAmountInCents: amountAsAny,
        },
      });
      
      this.logger.log(`[DepositService] Depósito PENDING criado: ${pendingDeposit.id}`);
    } catch (e) {
      this.logger.error('Erro ao salvar depósito PENDENTE no Prisma', e);
      throw new InternalServerErrorException(
        'Erro ao iniciar o depósito. Migração do Prisma falhou ou DB fora do ar.',
      );
    }

    try {
      // 3. Chamar o KeyclubService
      const callbackUrl = `${process.env.BASE_URL || 'https://api.paylure.com.br'}/api/v1/keyclub/callback/${webhookToken}`;
      
      const keyclubResponse = await this.keyclubService.createDeposit({
        amount: amountInBrl,
        externalId: pendingDeposit.id,
        payer: {
          name: user.name || 'N/A',
          email: user.email,
          document: documentNumbers, // ✅ Envia documento sem formatação
        },
        clientCallbackUrl: callbackUrl,
      });

      // 4. Atualizar depósito com dados da KeyClub
      const updatedDeposit = await this.prisma.deposit.update({
        where: { id: pendingDeposit.id },
        data: {
          externalId: keyclubResponse.transactionId,
          status: 'PENDING',
        },
      });

      this.logger.log(`[DepositService] ✅ Depósito atualizado com KeyClub: ${keyclubResponse.transactionId}`);

      // 5. Retornar apenas o PIX "copia e cola"
      return {
        pixCode: keyclubResponse.pixCode,
        depositId: updatedDeposit.id,
      };
    } catch (keyclubError: any) {
      this.logger.error('[DepositService] ❌ Erro da API da KeyClub', keyclubError.message || keyclubError);

      await this.prisma.deposit.update({
        where: { id: pendingDeposit.id },
        data: { status: 'FAILED' },
      });

      const errorMessage =
        keyclubError.response?.data?.message ||
        keyclubError.message ||
        'Erro desconhecido ao comunicar com o Gateway.';
      
      throw new InternalServerErrorException(`Erro ao criar depósito: ${errorMessage}`);
    }
  }

  /**
   * Busca o histórico de depósitos para o usuário logado.
   */
  async getHistory(userId: string) {
    if (!userId) {
      throw new BadRequestException('ID do usuário não fornecido.');
    }

    this.logger.log(`Buscando histórico de depósitos para o usuário: ${userId}`);

    const deposits = await this.prisma.deposit.findMany({
      where: {
        userId: userId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50,
    });

    const history = deposits.map((d) => ({
      id: d.id,
      type: 'DEPOSIT',
      amount: d.amountInCents / 100,
      status: d.status,
      date: d.createdAt.toISOString(),
    }));

    return {
      data: history,
    };
  }
}