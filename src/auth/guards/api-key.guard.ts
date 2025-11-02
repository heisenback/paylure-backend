// src/auth/guards/api-key.guard.ts
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
// Usa a estratégia que definimos como 'api-key'
export class ApiKeyGuard extends AuthGuard('api-key') {}