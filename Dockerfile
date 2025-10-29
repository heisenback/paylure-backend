# ---------- Etapa base ----------
FROM node:22-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm install

# ---------- Etapa de build ----------
COPY . .
RUN npm run build

# ---------- Etapa final ----------
EXPOSE 3000
CMD ["node", "dist/main.js"]
