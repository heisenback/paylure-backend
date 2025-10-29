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

# === TESTE: MOSTRAR O CONTEÚDO DA PASTA /dist ===
RUN echo "Conteúdo da pasta dist:" && ls -la dist || echo "Pasta dist NÃO encontrada!"
# ===============================================

# Rodar o prisma generate DEPOIS do build e da cópia
RUN npx prisma generate

# Expor a porta 3000
EXPOSE 3000

# Comando de inicialização: APENAS LIGA A API
CMD [ "node", "dist/main.js" ]