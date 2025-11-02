# Use a imagem node:20-alpine como base
FROM node:20-alpine AS build

# Define o diretório de trabalho
WORKDIR /app

# Copia package.json e package-lock.json (ou yarn.lock)
COPY package*.json ./

# Instala todas as dependências (incluindo devDependencies para o build)
RUN npm ci

# Copia os arquivos de configuração do TypeScript
COPY tsconfig*.json ./

# Copia o schema do prisma
COPY prisma/schema.prisma ./prisma/

# 🚨 Gerar o Prisma Client com os modelos
RUN npx prisma generate

# Copia o código fonte
COPY src ./src

# Executa a compilação do NestJS (TypeScript -> JavaScript)
RUN npm run build


# ===== Runtime (Imagem final, mais leve) =====
FROM node:20-alpine AS production

# 🚨 CORREÇÃO CRÍTICA AQUI
# Copia o lockfile para permitir que 'npm ci' funcione
COPY package-lock.json ./ 

# Copia apenas as dependências de produção
RUN npm ci --omit=dev

# Copia os arquivos de build e o node_modules de produção
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist

# Garante que o Prisma Client compilado esteja presente
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Define o comando de inicialização
CMD ["node", "dist/main"]