# ----------------------------------------------------
# 1. FASE DE BUILD (Criação da Imagem e Compilação)
# ----------------------------------------------------
# Usamos o node 20-alpine para ter um ambiente pequeno
FROM node:20-alpine AS builder

# Define o diretório de trabalho dentro do container
WORKDIR /usr/src/app

# Copia e instala dependências de produção e desenvolvimento
COPY package*.json ./
# O 'npm ci' é mais rápido e garante que a versão correta seja usada
RUN npm ci

# Copia o restante dos arquivos (código fonte .ts)
COPY . .

# Executa o build (compila TypeScript para JavaScript na pasta 'dist')
# 🚨 ESTE PASSO GERA O 'dist/main.js' QUE ESTAVA FALTANDO
RUN npm run build

# ----------------------------------------------------
# 2. FASE DE PRODUÇÃO (Imagem Final Enxuta e Segura)
# ----------------------------------------------------
# Usamos uma imagem base leve (apenas para execução)
FROM node:20-alpine AS production

# Define o diretório de trabalho
WORKDIR /usr/src/app

# Copia APENAS as dependências de PRODUÇÃO e as instala
COPY package*.json ./
RUN npm install --only=production

# Copia a pasta 'dist' (o código compilado) da fase de 'builder'
# 🚨 ISSO RESOLVE O "Cannot find module '/src/main.js'"
COPY --from=builder /usr/src/app/dist ./dist

# Comando para rodar a aplicação
# 🚨 COMANDO DE START CORRETO: Aponta para o arquivo .js na pasta 'dist'
CMD ["node", "dist/main.js"]