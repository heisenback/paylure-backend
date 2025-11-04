# ---------- Builder ----------
FROM node:20-alpine AS builder
WORKDIR /usr/src/app

# libs necessárias ao prisma em alpine
RUN apk add --no-cache openssl libc6-compat

# deps e prisma
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

# 🚨 CACHE BUSTER: Adiciona um argumento para forçar o rebuild da camada de código
# Você pode alterar o valor a cada vez que o Docker ignorar uma mudança de código.
ARG CACHE_BUST=2025-11-03-22h58m

# código + build
COPY . .
RUN npx prisma generate
RUN npm run build

# ---------- Runtime ----------
FROM node:20-alpine AS production
WORKDIR /usr/src/app
ENV NODE_ENV=production
RUN apk add --no-cache openssl libc6-compat

# só o necessário pro runtime
COPY --from=builder /usr/src/app/package*.json ./
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/prisma ./prisma

EXPOSE 3000

# 🚨 CORREÇÃO FINAL: Aponta para o caminho CORRETO 'dist/src/main.js' e usa o sleep.
CMD ["sh", "-c", "sleep 5 && node dist/src/main.js"]