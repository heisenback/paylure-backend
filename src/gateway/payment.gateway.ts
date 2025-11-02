// src/gateway/payment.gateway.ts
import {
  WebSocketGateway,
  SubscribeMessage,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

// Registra este componente como um Gateway de WebSockets
// Porta 3001 é usada aqui, mas pode ser configurada de outra forma se a 3000 for usada pelo HTTP
@WebSocketGateway({
  cors: {
    origin: '*', // Permite conexão de qualquer origem (necessário para o localhost:3000 do seu frontend)
  },
  // Opcional: define um namespace para evitar colisões
  // namespace: '/notifications', 
})
export class PaymentGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(PaymentGateway.name);

  /**
   * Conecta um socket à sala do usuário (baseado no ID do usuário).
   * O cliente deve enviar uma mensagem de 'join' assim que se conectar.
   */
  handleConnection(client: Socket, ...args: any[]) {
    this.logger.log(`Cliente conectado: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Cliente desconectado: ${client.id}`);
  }

  // O Frontend chamará este método para se juntar à sua sala de usuário
  @SubscribeMessage('joinUserRoom')
  handleJoinRoom(client: Socket, userId: string): void {
    // Sai de qualquer sala que ele possa estar para evitar duplicação
    client.rooms.forEach(room => {
      if (room !== client.id) {
        client.leave(room);
      }
    });

    // Entra na sala com o ID do usuário
    client.join(userId);
    this.logger.log(`Cliente ${client.id} entrou na sala do usuário: ${userId}`);
    client.emit('joinedRoom', userId);
  }

  /**
   * Método de sucesso: Notifica um usuário específico que o pagamento foi COMPLETED.
   */
  notifyPaymentComplete(userId: string, transactionId: string, amount: number) {
    this.server.to(userId).emit('paymentStatus', {
      success: true,
      status: 'COMPLETED',
      transactionId: transactionId,
      amount: amount,
      message: 'Seu depósito foi confirmado e o saldo atualizado!',
    });
    this.logger.log(`[WS] Notificação enviada para o Usuário ${userId}: Pagamento Concluído.`);
  }
}