# Usar a imagem oficial do Node.js Alpine
FROM node:20-alpine

# Definir o diretório de trabalho
WORKDIR /usr/src/app

# Copiar package.json e package-lock.json
COPY package*.json ./

# Copiar a pasta prisma inteira
COPY prisma ./prisma/

# Instalar TODAS as dependências (incluindo dev)
RUN npm install --legacy-peer-deps

# Copiar o resto do código-fonte
COPY . .

# Rodar o comando de build (cria a pasta /dist)
RUN npm run build

# Expor a porta 3000
EXPOSE 3000

# Comando de inicialização: PREPARA O PRISMA E SÓ DEPOIS LIGA A API
CMD ["sh", "-c", "npx prisma generate && npx prisma migrate deploy && node dist/main.js"]