FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node src ./src
COPY --chown=node:node data ./data
RUN mkdir -p /app/storage && chown node:node /app/storage
# Bootstrap fixes mounted-volume ownership, then drops to uid/gid 1000.
ENTRYPOINT ["node", "src/bootstrap.js"]
CMD ["src/index.js"]
