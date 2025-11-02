// src/auth/auth.service.ts
import {
  Injectable,
  ConflictException,
  UnauthorizedException, 
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { RegisterAuthDto } from './dto/register-auth.dto';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt'; 
import { LoginAuthDto } from './dto/login-auth.dto';
import * as uuid from 'uuid'; 
// 🚨 NOVO: Importa o módulo crypto nativo do Node.js para chaves seguras
import * as crypto from 'crypto'; 

// Função para gerar uma chave de API segura
function generateApiKey(length: number = 32): string {
  // Retorna uma string hexadecimal aleatória
  return crypto.randomBytes(length).toString('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  // --- Função de Cadastro (CORRIGIDA) ---
  async register(dto: RegisterAuthDto) {
    // 1. Verificar E-mail Único
    const userExists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (userExists) {
      throw new ConflictException('Este e-mail já está em uso.');
    }

    // 2. Geração de Dados FALSOS ÚNICOS e CHAVES DE API
    const uniqueCnpj = uuid.v4().replace(/-/g, '').substring(0, 14); 
    const defaultStoreName = `Loja-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    // Geração das chaves de API
    const apiKey = generateApiKey(16);
    const apiSecret = generateApiKey(32);

    // 3. Hashing de Senha
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(dto.password, salt);

    // 4. Criação Aninhada
    try {
        const userWithMerchant = await this.prisma.user.create({
            data: {
                email: dto.email,
                name: dto.name || 'Usuário Padrão', 
                password: hashedPassword,
                
                // 🔑 INCLUSÃO DAS CHAVES DE API
                apiKey: apiKey, 
                apiSecret: apiSecret,

                // Criação Aninhada do Merchant com dados únicos gerados
                merchant: {
                    create: {
                        storeName: defaultStoreName, 
                        cnpj: uniqueCnpj, // CNPJ ÚNICO GERADO
                    },
                },
            },
            select: {
                id: true,
                email: true,
                name: true,
                createdAt: true,
                updatedAt: true,
                // Garantimos que o merchant será incluído
                merchant: true, 
                // Também retornamos as novas chaves para o usuário ver
                apiKey: true,
                apiSecret: true,
            }
        });

        // Corrigido: Desestruturação funciona, pois `merchant` está em `select`
        const { merchant, ...userData } = userWithMerchant;

        return { 
            user: userData,
            merchant: merchant,
            message: 'Registro e Lojista criados com sucesso!' 
        };
    } catch (error) {
        if (error.code === 'P2002') { 
            throw new ConflictException('O e-mail fornecido já está em uso.');
        }
        throw error; 
    }
  }

  // --- Função de Login (CORRIGIDA) ---
  async login(dto: LoginAuthDto) {
    // 🚨 CORREÇÃO: Usar `select` ou `include` para garantir que `apiKey` e `apiSecret`
    // e `merchant` sejam carregados no objeto `user` antes da desestruturação.
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: {
        merchant: true, 
      }
    });

    if (!user) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    const payload = {
      sub: user.id, 
      email: user.email,
      name: user.name,
      merchantId: user.merchant?.id, 
    };

    // Corrigido: Desestruturação de `user` funciona, pois incluímos `merchant`
    const { password, merchant, ...userData } = user;

    return {
      access_token: await this.jwtService.signAsync(payload),
      user: userData,
      merchant: merchant,
    };
  }
}