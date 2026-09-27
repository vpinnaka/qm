FROM node:24-trixie-slim AS webui-build
WORKDIR /w
COPY plugins/web-ui/package.json plugins/web-ui/package-lock.json ./
RUN npm ci
COPY plugins/web-ui/index.html plugins/web-ui/shared.html plugins/web-ui/vite.config.ts plugins/web-ui/tsconfig.json ./
COPY plugins/web-ui/public ./public
COPY plugins/web-ui/src ./src
COPY plugins/chassis/src /chassis/src
COPY docs/images/slack-app-config-token-setup.gif /docs/images/slack-app-config-token-setup.gif
RUN npm run build

FROM node:24-trixie-slim AS connector-sdk-build
WORKDIR /app
COPY deploy/connector-sdk ./deploy/connector-sdk
RUN npm ci --prefix deploy/connector-sdk --ignore-scripts --no-audit --no-fund \
  && node deploy/connector-sdk/build.mjs

FROM node:24-trixie-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git python3 python3-pip postgresql \
  && rm -rf /var/lib/apt/lists/*
RUN pip3 install --break-system-packages --no-cache-dir river-client

WORKDIR /app
COPY package.json package-lock.json ./
COPY .husky/install.mjs .husky/install.mjs
RUN npm ci --omit=dev && rm -rf /root/.npm /tmp/node-compile-cache
COPY --from=connector-sdk-build /app/.generated/connector-sdk ./.generated/connector-sdk
COPY tsconfig.json ./
COPY src ./src
COPY cli/templates/slack-manifest.json ./cli/templates/slack-manifest.json
COPY skills-seed ./skills-seed
COPY plugins/onboarding ./plugins/onboarding
COPY plugins/chassis ./plugins/chassis

COPY plugins/web-ui/package.json plugins/web-ui/package-lock.json ./plugins/web-ui/
RUN npm ci --prefix plugins/web-ui --omit=dev && rm -rf /root/.npm /tmp/node-compile-cache
COPY plugins/web-ui/server ./plugins/web-ui/server
COPY plugins/web-ui/src/app-edit.ts ./plugins/web-ui/src/app-edit.ts
COPY --from=webui-build /w/dist-web ./plugins/web-ui/dist-web

COPY plugins/admin/package.json plugins/admin/package-lock.json ./plugins/admin/
RUN npm ci --prefix plugins/admin --omit=dev && rm -rf /root/.npm /tmp/node-compile-cache
COPY plugins/admin/src ./plugins/admin/src
COPY plugins/admin/ui ./plugins/admin/ui
COPY plugins/admin/public ./plugins/admin/public

COPY hackathon ./hackathon

ENV PATH=/usr/lib/postgresql/17/bin:$PATH
RUN mkdir -p /home/node/qm && chown -R node:node /home/node
EXPOSE 8000
USER node
CMD ["bash", "/app/hackathon/agent37/entrypoint.sh"]
