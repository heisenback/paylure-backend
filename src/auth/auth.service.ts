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

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  // --- Função de Cadastro (CORRIGIDA) ---
  async register(dto: RegisterAuthDto) {
    const userExists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (userExists) {
      throw new ConflictException('Este e-mail já está em uso.');
    }

    // 🚨 Hashing de Senha
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(dto.password, salt);

    // 🚨 AJUSTE SÊNIOR: Criação ANINHADA para garantir transacionalidade
    // Usamos a criação do usuário para ANINHAR a criação do Merchant.
    // Isso garante que se uma falhar, a outra falha automaticamente.
    // Presume-se que o modelo 'User' tenha um campo de relacionamento 'merchant'
    // ou que o modelo 'Merchant' tenha um campo 'user' para a relação.
    try {
        const userWithMerchant = await this.prisma.user.create({
            data: {
                email: dto.email,
                name: dto.name || 'Usuário Padrão',
                password: hashedPassword,
                // Criação Aninhada do Merchant
                merchant: {
                    create: {
                        storeName: dto.storeName || 'Minha Loja', 
                        cnpj: dto.cnpj || '00.000.000/0001-00',
                    },
                },
            },
            // Selecionamos o que queremos retornar, incluindo o Merchant, mas excluindo a senha
            select: {
                id: true,
                email: true,
                name: true,
                createdAt: true,
                updatedAt: true,
                merchant: true, // Incluímos o Merchant criado
            }
        });

        // 🚨 Retorno Simplificado
        // O objeto já vem limpo (sem a senha) graças ao `select` acima.
        const { merchant, ...userData } = userWithMerchant;

        return { 
            user: userData,
            merchant: merchant,
            message: 'Registro e Lojista criados com sucesso!' 
        };
    } catch (error) {
        // Em um ambiente real, você logaria esse erro.
        // Se houver um problema com UNIQUE (ex: CNPJ), ele será capturado aqui.
        if (error.code === 'P2002') { // Código de erro UNIQUE do Prisma
            throw new ConflictException('O CNPJ fornecido já está em uso.');
        }
        throw error; // Re-lança outros erros
    }
  }

  // --- Função de Login (Sem Alterações) ---
  async login(dto: LoginAuthDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      // 🚨 AJUSTE SÊNIOR: Incluir o Merchant no Login para retornar dados completos
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

    // 🚨 AJUSTE NO PAYLOAD: Adicionar merchantId ao token é crucial para o Gateway!
    const payload = {
      sub: user.id, 
      email: user.email,
      name: user.name,
      merchantId: user.merchant?.id, // Adicionamos o ID do Merchant
    };

    const { password, merchant, ...userData } = user;

    return {
      access_token: await this.jwtService.signAsync(payload),
      user: userData,
      merchant: merchant,
    };
  }
}