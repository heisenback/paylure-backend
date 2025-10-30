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

    // 🚨 AJUSTE 1: Hashing
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(dto.password, salt);

    // 🚨 AJUSTE 2: TRANSAÇÃO DO PRISMA (CRUCIAL!)
    // Criar o Usuário E o Lojista (Merchant) em uma única operação.
    const [user, merchant] = await this.prisma.$transaction([
        // 1. Criação do Usuário (User)
        this.prisma.user.create({
            data: {
                email: dto.email,
                name: dto.name,
                password: hashedPassword,
                // O campo `merchant` aqui é para a relação de volta (opcional no 'create')
                // A relação principal será criada no próximo passo.
            },
        }),
        // 2. Criação do Lojista (Merchant)
        // ATENÇÃO: Estou assumindo que o DTO de registro também tem 'storeName' e 'cnpj'
        this.prisma.merchant.create({
            data: {
                storeName: dto.storeName || 'Minha Loja', // <-- Se não estiver no DTO, defina um valor padrão
                cnpj: dto.cnpj || '00.000.000/0001-00',    // <-- O mesmo aqui (CNPJ é UNIQUE!)
                // Conecta o Merchant ao Usuário que acabou de ser criado
                user: {
                    connect: { email: dto.email } // Usa o email para conectar (funciona porque é unique)
                }
            },
        }),
    ]);
    
    // 🚨 AJUSTE 3: Retorno
    // Garantimos que o objeto retornado contenha informações do usuário e do merchant,
    // mas SEM a senha.
    const { password, ...userData } = user;

    return { 
        user: userData,
        merchant: merchant,
        message: 'Registro e Lojista criados com sucesso!' 
    };
  }

  // --- Função de Login (Sem Alterações) ---
  async login(dto: LoginAuthDto) {
    // ... CÓDIGO DO LOGIN PERMANECE IGUAL
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
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
    };

    return {
      access_token: await this.jwtService.signAsync(payload),
    };
  }
}