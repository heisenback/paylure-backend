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
COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps
# Copia APENAS o código compilado
COPY --from=builder /usr/src/app/dist ./dist

# Comando de inicialização: TENTA LIGAR A API DIRETAMENTE
CMD [ "node", "dist/main.js" ]