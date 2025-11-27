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
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  path: '/socket.io/',
  pingTimeout: 60000,
  pingInterval: 25000,
})
export class PaymentGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(PaymentGateway.name);
  // Mapa mantido para controle interno, mas vamos usar Salas (Rooms) para envio
  private userSockets = new Map<string, string>();

  afterInit(server: Server) {
    this.logger.log('🚀 WebSocket Gateway inicializado');
  }

  handleConnection(client: Socket) {
    // Tenta pegar o ID do auth ou da query string
    const rawUserId = 
      client.handshake.auth?.userId || 
      client.handshake.query?.userId;

    // 🔥 FIX 1: Força conversão para String para padronizar
    const userId = rawUserId ? String(rawUserId) : null;

    if (userId) {
      this.userSockets.set(userId, client.id);
      
      // 🔥 FIX 2: Cliente entra na sala "user:ID" (garantido ser string)
      client.join(`user:${userId}`);
      
      this.logger.log(`✅ Cliente conectado: ${client.id} | User: ${userId} | Room: user:${userId}`);
      
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
    
    // Limpeza do mapa
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
    // Apenas para debug de latência se precisar
    return 'pong';
  }

  // 🔥 FIX 3: Método genérico aceita number ou string e converte
  emitToUser(userId: string | number, event: string, data: any) {
    const stringUserId = String(userId);

    // Envia para TODOS os sockets desse usuário (caso ele tenha 2 abas abertas)
    // Usando .to() na sala é mais seguro que usar o socketId único
    const roomName = `user:${stringUserId}`;
    
    // Debug para você ver no terminal
    this.logger.log(`Tentando emitir '${event}' para sala '${roomName}'`);

    this.server.to(roomName).emit(event, data);
    
    return true;
  }

  notifyBalanceUpdate(userId: string | number, balance: number) {
    this.emitToUser(userId, 'balance_updated', { balance });
  }

  notifyDepositConfirmed(userId: string | number, deposit: any) {
    this.emitToUser(userId, 'deposit_confirmed', deposit);
  }

  notifyWithdrawalProcessed(userId: string | number, withdrawal: any) {
    this.emitToUser(userId, 'withdrawal_processed', withdrawal);
  }

  broadcastToAll(event: string, data: any) {
    this.server.emit(event, data);
    this.logger.log(`📢 Broadcast '${event}' enviado para todos`);
  }

  emitDepositUpdate(externalId: string, data: any) {
    this.server.emit('deposit_updated', { externalId, ...data });
  }

  emitWithdrawalUpdate(externalId: string, data: any) {
    this.server.emit('withdrawal_updated', { externalId, ...data });
  }
}