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
// 🚨 NOVO: Importar UUID para gerar IDs únicos (CNPJ falso)
import { v4 as uuidv4 } from 'uuid'; 

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  // --- Função de Cadastro (CORRIGIDA E MINIMALISTA) ---
  async register(dto: RegisterAuthDto) {
    // 1. Verificar E-mail Único (Regra mantida)
    const userExists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (userExists) {
      throw new ConflictException('Este e-mail já está em uso.');
    }

    // 2. 🚨 Geração de Dados FALSOS ÚNICOS (Para o Merchant)
    // Isso garante que o Merchant seja criado sem quebrar a restrição UNIQUE.
    const uniqueCnpj = uuidv4().replace(/-/g, '').substring(0, 14); // CNPJ único de 14 dígitos (falso)
    const defaultStoreName = `Loja-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    // 3. Hashing de Senha
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(dto.password, salt);

    // 4. Criação Aninhada
    try {
        const userWithMerchant = await this.prisma.user.create({
            data: {
                email: dto.email,
                name: dto.name || 'Usuário Padrão', // Usa o nome fornecido
                password: hashedPassword,
                
                // Criação Aninhada do Merchant com dados únicos gerados
                merchant: {
                    create: {
                        storeName: defaultStoreName, 
                        cnpj: uniqueCnpj, // CNPJ ÚNICO GERADO
                    },
                },
            },
            // Selecionamos o que queremos retornar
            select: {
                id: true,
                email: true,
                name: true,
                createdAt: true,
                updatedAt: true,
                merchant: true, 
            }
        });

        const { merchant, ...userData } = userWithMerchant;

        return { 
            user: userData,
            merchant: merchant,
            message: 'Registro e Lojista criados com sucesso!' 
        };
    } catch (error) {
        // 🚨 REMOVEMOS A CHECAGEM ESPECÍFICA DE CNPJ
        if (error.code === 'P2002') { 
            throw new ConflictException('O e-mail fornecido já está em uso.');
        }
        throw error; 
    }
  }

  // --- Função de Login (Sem Alterações) ---
  async login(dto: LoginAuthDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      // Inclui o Merchant no Login para retornar dados completos
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

    // Adicionar merchantId ao payload
    const payload = {
      sub: user.id, 
      email: user.email,
      name: user.name,
      merchantId: user.merchant?.id, 
    };

    const { password, merchant, ...userData } = user;

    return {
      access_token: await this.jwtService.signAsync(payload),
      user: userData,
      merchant: merchant,
    };
  }
}