# ---------- Etapa base ----------
FROM node:22-alpine AS base
WORKDIR /app

# Copia apenas arquivos de dependências
COPY package*.json ./

# Instala o Nest CLI e as dependências do projeto
RUN npm install -g @nestjs/cli && npm install

# ---------- Etapa de build ----------
COPY . .
RUN npm run build

# ---------- Etapa final ----------
EXPOSE 3000
CMD ["npm", "run", "start:prod"]
