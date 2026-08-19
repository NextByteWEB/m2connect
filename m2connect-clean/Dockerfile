FROM node:18-alpine
WORKDIR /app

# Dependencies installieren
COPY package*.json ./
RUN npm ci --only=production

# Alle Dateien kopieren (HTML, JS, Assets)
COPY . .

# Port exposen
EXPOSE 3000

# Healthcheck für CapRover
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
