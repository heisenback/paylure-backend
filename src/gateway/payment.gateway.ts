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

const ORIGINS = (process.env.SOCKET_CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
const SOCKET_PATH = process.env.SOCKET_PATH || '/socket.io';
const PING_INTERVAL = Number(process.env.SOCKET_PING_INTERVAL || 25000);
...

@WebSocketGateway({
  cors: {
    origin: ORIGINS.length > 0 ? ORIGINS : '*',
    credentials: true,
  },
  path: SOCKET_PATH,
  pingInterval: PING_INTERVAL,
  pingTimeout: 60000,
})
export class PaymentGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(PaymentGateway.name);

  @WebSocketServer()
  server!: Server;

  private lastLogByClient = new Map<string, number>();
  private static readonly LOG_DEBOUNCE_MS = 5000;
  
  private shouldLog(clientId: string): boolean {
    const now = Date.now();
    const prev = this.lastLogByClient.get(clientId) || 0;
    if (now - prev > PaymentGateway.LOG_DEBOUNCE_MS) {
      this.lastLogByClient.set(clientId, now);
      return true;
    }
    return false;
  }

  handleConnection(client: Socket) {
    if (this.shouldLog(client.id)) {
      const ua = (client.handshake.headers['user-agent'] as string) || 'unknown';
      const ip =
        (client.handshake.headers['x-forwarded-for'] as string) ||
        (client.conn.remoteAddress as string) ||
        'n/a';
      // this.logger.log(`[PaymentGateway] Cliente conectado: ${client.id} | ip=${ip} | ua=${ua}`);
    }
  }

  handleDisconnect(client: Socket) {
    const ua = (client.handshake.headers['user-agent'] as string) || 'unknown';
    const ip =
      (client.handshake.headers['x-forwarded-for'] as string) ||
      (client.conn.remoteAddress as string) ||
      'n/a';
    this.logger.log(`[PaymentGateway] Cliente desconectado: ${client.id} | ip=${ip} | ua=${ua}`);
  }

  @SubscribeMessage('joinRoom')
  handleJoinRoom(
    @MessageBody() payload: { roomId: string; userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { roomId, userId } = payload;

    if (!roomId || !userId) {
      this.logger.warn(`[PaymentGateway] joinRoom: payload inválido: ${JSON.stringify(payload)}`);
      return;
    }

    const roomName = `room:${roomId}`;
    client.join(roomName);
    this.logger.log(
      `[PaymentGateway] Usuário ${userId} entrou na sala ${roomName} (socketId=${client.id})`,
    );
  }

  @SubscribeMessage('leaveRoom')
  handleLeaveRoom(
    @MessageBody() payload: { roomId: string; userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { roomId, userId } = payload;

    if (!roomId || !userId) {
      this.logger.warn(`[PaymentGateway] leaveRoom: payload inválido: ${JSON.stringify(payload)}`);
      return;
    }

    const roomName = `room:${roomId}`;
    client.leave(roomName);
    this.logger.log(
      `[PaymentGateway] Usuário ${userId} saiu da sala ${roomName} (socketId=${client.id})`,
    );
  }

  // ✅ EVENTO: PIX gerado
  notifyPixCreated(userId: string, data: { depositId: string; qrCode: string; expiresAt: string }) {
    this.server.emit('pix:created', {
      userId,
      depositId: data.depositId,
      qrCode: data.qrCode,
      expiresAt: data.expiresAt,
      timestamp: new Date().toISOString(),
    });
    this.logger.log(
      `✅ Evento 'pix:created' emitido para userId: ${userId}, depositId: ${data.depositId}`,
    );
  }

  // ✅ EVENTO: PIX expirado
  notifyPixExpired(userId: string, data: { depositId: string }) {
    this.server.emit('pix:expired', {
      userId,
      depositId: data.depositId,
      timestamp: new Date().toISOString(),
    });
    this.logger.log(
      `⚠️ Evento 'pix:expired' emitido para userId: ${userId}, depositId: ${data.depositId}`,
    );
  }

  // ✅ EVENTO: Depósito confirmado
  notifyDepositConfirmed(userId: string, data: { depositId: string; amount: number }) {
    this.server.emit('deposit:confirmed', {
      userId,
      depositId: data.depositId,
      amount: data.amount,
      timestamp: new Date().toISOString(),
    });
    this.logger.log(
      `✅ Evento 'deposit:confirmed' emitido - userId: ${userId}, valor: R$ ${(data.amount / 100).toFixed(2)}`,
    );
  }

  // ✅ EVENTO: Saque completado
  notifyWithdrawalCompleted(userId: string, data: { withdrawalId: string; amount: number }) {
    this.server.emit('withdrawal:completed', {
      userId,
      withdrawalId: data.withdrawalId,
      amount: data.amount,
      timestamp: new Date().toISOString(),
    });
    this.logger.log(`✅ Evento 'withdrawal:completed' emitido para userId: ${userId}`);
  }

  // ✅ EVENTO: Saque falhou
  notifyWithdrawalFailed(userId: string, data: { withdrawalId: string; reason: string }) {
    this.server.emit('withdrawal:failed', {
      userId,
      withdrawalId: data.withdrawalId,
      reason: data.reason,
      timestamp: new Date().toISOString(),
    });
    this.logger.log(`❌ Evento 'withdrawal:failed' emitido para userId: ${userId}`);
  }
}
