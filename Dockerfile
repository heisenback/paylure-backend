# ---------- Builder ----------
FROM node:20-alpine AS builder
WORKDIR /usr/src/app

# deps do prisma openssl (e compat) para ambientes alpine
RUN apk add --no-cache openssl libc6-compat

# instalar deps
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

# copiar código e gerar prisma + build
COPY . .
RUN npx prisma generate
RUN npm run build

# ---------- Runtime ----------
FROM node:20-alpine AS production
WORKDIR /usr/src/app
ENV NODE_ENV=production

# deps necessárias em runtime para prisma client em alpine
RUN apk add --no-cache openssl libc6-compat

# copiar apenas o necessário
COPY --from=builder /usr/src/app/package*.json ./
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/prisma ./prisma

EXPOSE 3000

# <<< AQUI ESTAVA O PROBLEMA
CMD ["node","dist/main.js"]
