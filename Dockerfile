# Usar a imagem oficial do Node.js Alpine
FROM node:20-alpine

# Definir o diretório de trabalho
WORKDIR /usr/src/app

# Copiar package.json e package-lock.json
COPY package*.json ./

# Instalar TODAS as dependências (incluindo dev)
RUN npm install --legacy-peer-deps

# Copiar o resto do código-fonte (INCLUINDO a pasta prisma)
COPY . .

# Rodar o comando de build (cria a pasta /dist)
RUN npm run build

# Expor a porta 3000
EXPOSE 3000

# Comando de inicialização: APENAS LIGA A API
CMD [ "node", "dist/main.js" ]