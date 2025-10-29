# FASE DE BUILD (builder) - Cria o /dist
FROM node:20-alpine AS builder
WORKDIR /usr/src/app
COPY package*.json ./
COPY prisma ./prisma/
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

# FASE DE PRODUÇÃO (production) - Onde a API roda
FROM node:20-alpine AS production
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/prisma ./prisma
COPY --from=builder /usr/src/app/node_modules/.prisma/ ./node_modules/.prisma/
COPY --from=builder /usr/src/app/node_modules/prisma/ ./node_modules/prisma/

# Comando de inicialização: APENAS LIGA A API
CMD [ "node", "dist/main.js" ]