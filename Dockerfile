FROM node:24-alpine

WORKDIR /app

# Install deps in their own layer so they're only reinstalled when the manifests
# change, not on every source edit.
COPY package.json package-lock.json ./
RUN npm i

COPY . .
RUN npm run build

EXPOSE 3000

# Liveness probe so `docker ps` and orchestrators can see whether the app is
# actually serving. Uses node's built-in fetch, so we don't need curl in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/src/index.js"]
