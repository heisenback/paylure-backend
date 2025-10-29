# Etapa 1: build
FROM node:20-alpine AS build

WORKDIR /app

# Copia apenas arquivos de dependências primeiro
COPY package*.json ./

# Instala dependências
RUN npm ci

# Copia o restante do projeto
COPY . .

# Gera o client Prisma (caso use Prisma)
RUN npx prisma generate || true

# Compila o código (gera /dist)
RUN npm run build || npx tsc

# Etapa 2: execução
FROM node:20-alpine

WORKDIR /app

# Copia apenas o necessário do build anterior
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package*.json ./

# Expõe porta da API
EXPOSE 3000

# Comando final
CMD ["node", "dist/index.js"]
