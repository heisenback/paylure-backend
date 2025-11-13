// src/gateway/payment.gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class PaymentGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(PaymentGateway.name);
  private userSockets = new Map<string, Socket>();

  handleConnection(client: Socket) {
    const userId = client.handshake.query.userId as string;
    
    if (userId) {
      this.userSockets.set(userId, client);
      this.logger.log(`✅ Cliente conectado: ${client.id} | User: ${userId}`);
    } else {
      this.logger.warn(`⚠️ Cliente conectado sem userId: ${client.id}`);
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.handshake.query.userId as string;
    
    if (userId) {
      this.userSockets.delete(userId);
      this.logger.log(`🔌 Cliente desconectado: ${client.id} | User: ${userId}`);
    } else {
      this.logger.log(`🔌 Cliente desconectado: ${client.id}`);
    }
  }

  /**
   * Notifica um usuário específico sobre atualização de saldo
   */
  notifyBalanceUpdate(userId: string, newBalance: number) {
    const socket = this.userSockets.get(userId);
    
    if (socket) {
      socket.emit('balance_updated', { 
        balance: newBalance,
        timestamp: new Date().toISOString(),
      });
      this.logger.log(`💰 Saldo atualizado enviado para User ${userId}: R$${(newBalance / 100).toFixed(2)}`);
    } else {
      this.logger.warn(`⚠️ Socket não encontrado para User ${userId}`);
    }
  }

  /**
   * Emite atualização de depósito para todos os clientes conectados
   */
  emitDepositUpdate(externalId: string, data: any) {
    this.server.emit('deposit_update', {
      externalId,
      ...data,
      timestamp: new Date().toISOString(),
    });
    this.logger.log(`📨 Atualização de depósito emitida: ${externalId}`);
  }

  /**
   * Emite atualização de saque para todos os clientes conectados
   */
  emitWithdrawalUpdate(externalId: string, data: any) {
    this.server.emit('withdrawal_update', {
      externalId,
      ...data,
      timestamp: new Date().toISOString(),
    });
    this.logger.log(`📨 Atualização de saque emitida: ${externalId}`);
  }

  /**
   * Notifica usuário específico sobre depósito confirmado
   */
  notifyDepositConfirmed(userId: string, depositData: any) {
    const socket = this.userSockets.get(userId);
    
    if (socket) {
      socket.emit('deposit_confirmed', depositData);
      this.logger.log(`✅ Depósito confirmado notificado para User ${userId}`);
    }
  }

  /**
   * Notifica usuário específico sobre saque processado
   */
  notifyWithdrawalProcessed(userId: string, withdrawalData: any) {
    const socket = this.userSockets.get(userId);
    
    if (socket) {
      socket.emit('withdrawal_processed', withdrawalData);
      this.logger.log(`✅ Saque processado notificado para User ${userId}`);
    }
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket): string {
    return 'pong';
  }
}