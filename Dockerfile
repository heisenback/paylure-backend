# ===== Build =====
FROM node:20-alpine AS build
WORKDIR /app

# Copia e instala
COPY package*.json ./
RUN npm ci

# Copia código e compila
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

# ===== Runtime =====
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# Só dependências de produção
COPY package*.json ./
RUN npm ci --omit=dev

# Copia dist e prisma (se houver)
COPY --from=build /app/dist ./dist
COPY prisma ./prisma

# Gera prisma client se necessário
RUN npx prisma generate || true

EXPOSE 3000

CMD ["node", "dist/main.js"]
