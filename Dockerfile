# One image for every Node service in the workspace; Compose picks the command.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Manifests first so dependency installs are cached across source edits.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/domain/package.json packages/domain/
COPY packages/db/package.json packages/db/
COPY packages/integrations/package.json packages/integrations/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY services/erp-sim/package.json services/erp-sim/
COPY apps/web/package.json apps/web/
# tsx runs TypeScript directly, so dev dependencies are part of the runtime image.
RUN npm ci --include=dev --no-audit --no-fund

COPY . .
# The ops console is a static bundle, built once into apps/web/dist and served by `vite preview`.
RUN npm run build -w @pharos/web \
  # vite writes its bundled config under node_modules/.vite-temp at start; the server runs as node.
  && mkdir -p apps/web/node_modules/.vite-temp \
  && chown -R node:node apps/web/node_modules

USER node
CMD ["npm", "run", "start", "-w", "@pharos/api"]
