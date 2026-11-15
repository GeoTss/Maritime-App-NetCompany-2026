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
# tsx runs TypeScript directly, so dev dependencies are part of the runtime image.
RUN npm ci --include=dev --no-audit --no-fund

COPY . .

USER node
CMD ["npm", "run", "start", "-w", "@pharos/api"]
