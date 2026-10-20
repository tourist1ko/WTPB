FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node src ./src
COPY --chown=node:node data ./data
COPY --chown=node:node assets ./assets
RUN mkdir -p /app/storage && chown node:node /app/storage
# Bootstrap fixes mounted-volume ownership, then drops to uid/gid 1000.
ENTRYPOINT ["node", "src/bootstrap.js"]
CMD ["src/index.js"]
