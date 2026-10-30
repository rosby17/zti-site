# Serveur de ZTi (API, tableau de bord, espace ambassadeurs). Image légère, utilisateur sans droits, volume pour les fichiers.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DOSSIER_FICHIERS=/donnees/fichiers
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY migrations ./migrations
COPY admin ./admin
COPY espace ./espace
RUN mkdir -p /donnees/fichiers && chown -R node:node /donnees
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/v1/sante || exit 1
CMD ["node", "src/index.js"]
