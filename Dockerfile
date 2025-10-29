# ---------- Etapa base ----------
FROM node:22-alpine
WORKDIR /app

# Copia apenas arquivos de dependências
COPY package*.json ./

# Instala dependências + tsx
RUN npm install && npm install -g tsx

# Copia o restante do código
COPY . .

# Exposição da porta
EXPOSE 3000

# Comando para rodar direto o TypeScript
CMD ["tsx", "src/main.ts"]
