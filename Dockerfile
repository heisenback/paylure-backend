# --- STAGE 1: Build ---
FROM node:20-alpine AS builder

# Define o diretório de trabalho dentro do container
WORKDIR /usr/src/app

# Copia os arquivos de configuração do projeto
COPY package*.json ./
COPY prisma ./prisma/

# Instala as dependências
RUN npm install

# Copia o restante do código-fonte
COPY . .

# Gera o cliente Prisma e faz o build do NestJS
# O comando 'npx prisma generate' deve ser executado antes do build
RUN npx prisma generate
RUN npm run build

# --- STAGE 2: Production ---
FROM node:20-alpine AS production

# Define o diretório de trabalho
WORKDIR /usr/src/app

# Copia apenas os arquivos necessários para a produção
COPY --from=builder /usr/src/app/package*.json ./
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/prisma ./prisma

# O comando 'npx prisma generate' deve ser executado novamente na imagem final
# para garantir que o cliente Prisma esteja presente e configurado corretamente
RUN npx prisma generate

# Expõe a porta que o NestJS vai usar (3000 por padrão)
EXPOSE 3000

# Comando para iniciar a aplicação em modo de produção
CMD [ "node", "dist/main" ]
