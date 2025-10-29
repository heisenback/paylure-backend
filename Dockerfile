# FASE DE BUILD (builder) - Cria o /dist
FROM node:20-alpine AS builder
WORKDIR /usr/src/app
COPY package*.json ./
# Copia a pasta prisma SÓ para ter o schema para o build
COPY prisma ./prisma/
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

# FASE DE PRODUÇÃO (production) - Onde a API roda
FROM node:20-alpine AS production
WORKDIR /usr/src/app

# Copia os package.json e instala SÓ as dependências de produção
COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps

# Copia o schema do Prisma para a imagem de produção (necessário para as migrations)
COPY prisma ./prisma/

# Gera o Prisma Client (um passo que seus logs mostram estar acontecendo)
RUN npx prisma generate

# Copia o código compilado da fase de "build"
COPY --from=builder /usr/src/app/dist ./dist

# Comando de inicialização
# 1. Roda as migrations (seus logs mostram que isso está rodando)
# 2. Inicia a aplicação (usando o comando exato do seu package.json)
CMD sh -c "npx prisma migrate deploy && node dist/main.js"