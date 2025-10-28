// src/auth/auth.service.ts
import {
  Injectable,
  ConflictException,
  UnauthorizedException, // 1. Importar o erro de "Não Autorizado"
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { RegisterAuthDto } from './dto/register-auth.dto';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt'; // 2. Importar o serviço de JWT

// Vamos criar este DTO no próximo passo
import { LoginAuthDto } from './dto/login-auth.dto';

@Injectable()
export class AuthService {
  // 3. Pedir ao Nest para injetar o Prisma E o JwtService
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  // --- Função de Cadastro (que já fizemos) ---
  async register(dto: RegisterAuthDto) {
    const userExists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (userExists) {
      throw new ConflictException('Este e-mail já está em uso.');
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(dto.password, salt);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        password: hashedPassword,
      },
    });

    const { password, ...result } = user;
    return result;
  }

  // --- 4. NOVA FUNÇÃO DE LOGIN ---
  async login(dto: LoginAuthDto) {
    // 1. Achar o usuário pelo email
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // Se não achar, joga um erro de "Não autorizado"
    if (!user) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    // 2. Comparar a senha enviada com a senha embaralhada do banco
    const isPasswordValid = await bcrypt.compare(dto.password, user.password);

    // Se as senhas não baterem, joga o mesmo erro
    if (!isPasswordValid) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    // 3. Se tudo estiver certo, criar o "payload" do crachá
    // O "payload" são os dados que guardamos DENTRO do crachá
    const payload = {
      sub: user.id, // "sub" (subject) é o ID do usuário
      email: user.email,
      name: user.name,
    };

    // 4. Gerar e retornar o crachá (Access Token)
    return {
      access_token: await this.jwtService.signAsync(payload),
    };
  }
}