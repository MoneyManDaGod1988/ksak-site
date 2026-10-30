FROM node:22-alpine
# better-sqlite3 build tools
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
# Trial installers ship inside the image (exact file names in src/server.js PLUGINS list).
COPY downloads ./downloads
ENV NODE_ENV=production
# Defaults only — hosts can override via env vars.
#   DB_PATH: SQLite DB file. In production (Render) it points at the
#            persistent disk mounted at /data, so accounts survive redeploys.
#            The app creates the parent directory if it doesn't exist.
#   DOWNLOADS_DIR: the installers copied above.
ENV DB_PATH=/data/ksak.db DOWNLOADS_DIR=/app/downloads
EXPOSE 3000
CMD ["node", "src/server.js"]
