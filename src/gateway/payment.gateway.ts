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
const PING_TIMEOUT = Number(process.env.SOCKET_PING_TIMEOUT || 60000);
const TRANSPORTS = (process.env.SOCKET_TRANSPORTS || 'websocket,polling')
  .split(',')
  .map(t => t.trim() as 'websocket' | 'polling')
  .filter(Boolean);

const corsOrigins: (string | RegExp)[] = [];
for (const o of ORIGINS) {
  if (o === '*.vercel.app' || o === 'https://*.vercel.app') {
    corsOrigins.push(/^(https?:\/\/)?([a-z0-9-]+\.)*vercel\.app$/i);
  } else if (o) {
    corsOrigins.push(o);
  }
}
if (!corsOrigins.length) {
  corsOrigins.push(
    'http://localhost:3000',
    'http://localhost:3001',
    'https://paylure.com.br',
    'https://www.paylure.com.br',
    'https://api.paylure.com.br',
    /^(https?:\/\/)?([a-z0-9-]+\.)*vercel\.app$/i
  );
}

@WebSocketGateway({
  cors: {
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST'],
  },
  transports: TRANSPORTS,
  allowEIO3: true,
  pingInterval: PING_INTERVAL,
  pingTimeout: PING_TIMEOUT,
  path: SOCKET_PATH,
  perMessageDeflate: true,
  httpCompression: true,
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true,
  },
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
      this.logger.log(`[PaymentGateway] Cliente conectado: ${client.id} | ip=${ip} | ua=${ua}`);
    }
  }

  handleDisconnect(client: Socket) {
    if (this.shouldLog(client.id)) {
      this.logger.log(`[PaymentGateway] Cliente desconectado: ${client.id}`);
    }
  }

  @SubscribeMessage('ping')
  handlePing(@MessageBody() _payload: any, @ConnectedSocket() client: Socket) {
    client.emit('pong', { t: Date.now() });
  }

  emitDepositUpdate(externalId: string, data: any) {
    this.server.emit('deposit:update', { externalId, ...data });
  }

  emitWithdrawalUpdate(externalId: string, data: any) {
    this.server.emit('withdrawal:update', { externalId, ...data });
  }

  notifyBalanceUpdate(userId: string, newBalance: number) {
    this.server.emit(`balance:updated:${userId}`, {
      type: 'BALANCE_UPDATED',
      balance: newBalance,
      timestamp: new Date().toISOString(),
    });
    this.logger.log(`Notificação de saldo atualizado enviada para usuário ${userId}`);
  }

  notifyDepositConfirmed(userId: string, data: { depositId: string; amount: number }) {
    this.server.emit(`deposit:confirmed:${userId}`, {
      type: 'DEPOSIT_CONFIRMED',
      ...data,
      timestamp: new Date().toISOString(),
    });
    this.logger.log(`Notificação de depósito confirmado enviada para usuário ${userId}`);
  }

  notifyWithdrawalCompleted(userId: string, data: { withdrawalId: string; amount: number }) {
    this.server.emit(`withdrawal:completed:${userId}`, {
      type: 'WITHDRAWAL_COMPLETED',
      ...data,
      timestamp: new Date().toISOString(),
    });
    this.logger.log(`Notificação de saque completado enviada para usuário ${userId}`);
  }

  notifyWithdrawalFailed(userId: string, data: { withdrawalId: string; reason: string }) {
    this.server.emit(`withdrawal:failed:${userId}`, {
      type: 'WITHDRAWAL_FAILED',
      ...data,
      timestamp: new Date().toISOString(),
    });
    this.logger.log(`Notificação de saque falhou enviada para usuário ${userId}`);
  }
}