# =========================
# 1) STAGE: builder
# =========================
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Instala dependências nativas necessárias para o prisma no build
RUN apk add --no-cache openssl libc6-compat

# Copia apenas o que é necessário para resolver dependências
COPY package*.json ./
COPY prisma ./prisma/

# Dependências completas para build
RUN npm ci

# Copia o restante do projeto e gera o cliente do Prisma
COPY . .
RUN npx prisma generate

# Compila o Nest para produção
RUN npm run build

# =========================
# 2) STAGE: production
# =========================
FROM node:20-alpine AS production

WORKDIR /usr/src/app
ENV NODE_ENV=production

# Dependências do prisma em runtime
RUN apk add --no-cache openssl libc6-compat

# Copia apenas o que é necessário para rodar
COPY --from=builder /usr/src/app/package*.json ./
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/prisma ./prisma

# Gera o client do Prisma dentro da imagem final (garante compatibilidade)
RUN npx prisma generate

EXPOSE 3000

# Se seu main.ts usa process.env.PORT, esse CMD serve:
CMD ["node", "dist/main.js"]
