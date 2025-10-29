# ---------- Etapa base ----------
FROM node:22-alpine AS base
WORKDIR /app

# Copia apenas arquivos de dependências
COPY package*.json ./

# Instala as dependências
RUN npm install

# ---------- Etapa de build ----------
# Copia o restante do código
COPY . .

# Compila o código TypeScript para JavaScript
RUN npm run build

# ---------- Etapa final ----------
# Expõe a porta usada pela aplicação
EXPOSE 3000

# Comando padrão para iniciar o backend
CMD ["node", "dist/main.js"]
