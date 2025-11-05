// src/gateway/payment.gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

/**
 * Gateway WebSocket para notificações em tempo real de pagamentos.
 * 
 * Usado para notificar o frontend quando:
 * - Um depósito (PIX) é confirmado
 * - Um saque é completado ou falha
 * - O saldo do usuário é atualizado
 */
@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
  namespace: '/payments', // ws://localhost:4000/payments
})
export class PaymentGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(PaymentGateway.name);

  /**
   * Chamado quando um cliente se conecta ao WebSocket
   */
  handleConnection(client: Socket) {
    this.logger.log(`Cliente conectado: ${client.id}`);
  }

  /**
   * Chamado quando um cliente se desconecta
   */
  handleDisconnect(client: Socket) {
    this.logger.log(`Cliente desconectado: ${client.id}`);
  }

  /**
   * Notifica um usuário específico sobre um depósito confirmado
   */
  notifyDepositConfirmed(userId: string, data: { depositId: string; amount: number }) {
    this.server.emit(`deposit:confirmed:${userId}`, {
      type: 'DEPOSIT_CONFIRMED',
      depositId: data.depositId,
      amount: data.amount,
      timestamp: new Date().toISOString(),
    });

    this.logger.log(`Notificação de depósito enviada para usuário ${userId}`);
  }

  /**
   * Notifica um usuário específico sobre um saque completado
   */
  notifyWithdrawalCompleted(userId: string, data: { withdrawalId: string; amount: number }) {
    this.server.emit(`withdrawal:completed:${userId}`, {
      type: 'WITHDRAWAL_COMPLETED',
      withdrawalId: data.withdrawalId,
      amount: data.amount,
      timestamp: new Date().toISOString(),
    });

    this.logger.log(`Notificação de saque completado enviada para usuário ${userId}`);
  }

  /**
   * Notifica um usuário específico sobre um saque que falhou
   */
  notifyWithdrawalFailed(userId: string, data: { withdrawalId: string; reason: string }) {
    this.server.emit(`withdrawal:failed:${userId}`, {
      type: 'WITHDRAWAL_FAILED',
      withdrawalId: data.withdrawalId,
      reason: data.reason,
      timestamp: new Date().toISOString(),
    });

    this.logger.log(`Notificação de saque falhado enviada para usuário ${userId}`);
  }

  /**
   * Notifica um usuário sobre atualização de saldo
   */
  notifyBalanceUpdate(userId: string, newBalance: number) {
    this.server.emit(`balance:updated:${userId}`, {
      type: 'BALANCE_UPDATED',
      balance: newBalance,
      timestamp: new Date().toISOString(),
    });

    this.logger.log(`Notificação de saldo atualizado enviada para usuário ${userId}`);
  }
}