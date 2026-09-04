# Build dependencies: the full tree, needed to compile and to run the test suite.
# Never copied into the runtime stage.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# Runtime dependencies only. Keeping this separate is what stops vitest, vite,
# esbuild and the rest of the dev toolchain from reaching the shipped image.
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
# Compile the operational scripts to plain JS so the runtime image needs no tsx.
# tsx bundles esbuild, and shipping it would put a flagged package back into the
# image for the sake of one command. --packages=external keeps pg and friends
# resolving from the production node_modules rather than being inlined.
RUN npm run build:scripts

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# .next/standalone's server.js reads PORT and HOSTNAME and defaults to
# localhost:3000. The -p 4000 in the npm scripts applies to `next dev` and
# `next start`, not to the standalone server, so without these the container
# listens on 3000 while the port mapping and the healthcheck both target 4000 -
# and nothing is reachable. Binding 0.0.0.0 is what lets the mapping through.
ENV PORT=4000
ENV HOSTNAME=0.0.0.0

# next.config.ts sets output: "standalone", so .next/standalone carries server.js
# plus the traced subset of node_modules it actually needs.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/dist-scripts ./dist-scripts
COPY --from=build /app/package.json ./package.json

# The production dependency tree, for `npm run migrate:prod` and the seed -
# server.js itself needs nothing beyond what standalone already traced. This is
# larger than the traced set but contains no dev tooling, which is the point.
COPY --from=prod-deps /app/node_modules ./node_modules

# The node image ships an unprivileged `node` user; the default is root.
USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
