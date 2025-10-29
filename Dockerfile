# FASE DE BUILD (builder)
FROM node:20-alpine AS builder
WORKDIR /usr/src/app

# Instala dependências e faz o build
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

# ---

# FASE DE PRODUÇÃO (production)
FROM node:20-alpine
WORKDIR /usr/src/app

# Copia só o necessário para rodar
COPY package*.json ./
COPY prisma ./prisma/
RUN npm install --omit=dev --legacy-peer-deps

# Copia TODOS os arquivos do build (dist, node_modules, etc)
COPY --from=builder /usr/src/app .

# Comando de inicialização
CMD sh -c "npx prisma migrate deploy && node dist/main.js"