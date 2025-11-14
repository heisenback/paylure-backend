// src/gateway/payment.gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: [
      'https://paylure.com.br',
      'https://www.paylure.com.br',
      'http://localhost:3001',
      'http://localhost:3000',
    ],
    credentials: true,
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'], // ✅ Permite fallback
  allowEIO3: true,
  path: '/socket.io/', // ✅ Path explícito
  pingTimeout: 60000,
  pingInterval: 25000,
})
export class PaymentGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(PaymentGateway.name);
  private userSockets = new Map<string, string>(); // userId -> socketId

  afterInit(server: Server) {
    this.logger.log('🚀 WebSocket Gateway inicializado');
  }

  handleConnection(client: Socket) {
    this.logger.log(`✅ Cliente conectado: ${client.id}`);
    
    // Pega userId dos handshake auth ou query
    const userId = 
      client.handshake.auth?.userId || 
      client.handshake.query?.userId as string;

    if (userId) {
      this.userSockets.set(userId, client.id);
      client.join(`user:${userId}`);
      this.logger.log(`👤 UserId ${userId} mapeado para socket ${client.id}`);
      
      // Confirma conexão
      client.emit('connected', { 
        socketId: client.id, 
        userId,
        timestamp: new Date().toISOString() 
      });
    } else {
      this.logger.warn(`⚠️ Cliente ${client.id} conectou sem userId`);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`❌ Cliente desconectado: ${client.id}`);
    
    // Remove do mapa
    for (const [userId, socketId] of this.userSockets.entries()) {
      if (socketId === client.id) {
        this.userSockets.delete(userId);
        this.logger.log(`👤 UserId ${userId} removido do mapa`);
        break;
      }
    }
  }

  @SubscribeMessage('ping')
  handlePing(client: Socket): string {
    this.logger.log(`🏓 Ping recebido de ${client.id}`);
    return 'pong';
  }

  // ✅ Métodos para emitir eventos para usuários específicos
  emitToUser(userId: string, event: string, data: any) {
    const socketId = this.userSockets.get(userId);
    if (socketId) {
      this.server.to(`user:${userId}`).emit(event, data);
      this.logger.log(`📤 Evento '${event}' enviado para userId ${userId}`);
      return true;
    } else {
      this.logger.warn(`⚠️ UserId ${userId} não está conectado`);
      return false;
    }
  }

  // ✅ Notificar saldo atualizado
  notifyBalanceUpdate(userId: string, balance: number) {
    this.emitToUser(userId, 'balance_updated', { balance });
  }

  // ✅ Notificar depósito confirmado
  notifyDepositConfirmed(userId: string, deposit: any) {
    this.emitToUser(userId, 'deposit_confirmed', deposit);
  }

  // ✅ Notificar saque processado
  notifyWithdrawalProcessed(userId: string, withdrawal: any) {
    this.emitToUser(userId, 'withdrawal_processed', withdrawal);
  }

  // ✅ Broadcast para todos
  broadcastToAll(event: string, data: any) {
    this.server.emit(event, data);
    this.logger.log(`📢 Broadcast '${event}' enviado para todos`);
  }
}