FROM public.ecr.aws/docker/library/node:22-alpine AS build
WORKDIR /app
ARG NPM_REGISTRY="https://registry.npmmirror.com"
RUN npm install --global pnpm@10.8.1 --registry="$NPM_REGISTRY" \
    --fetch-retries=3 --fetch-timeout=120000
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN printf '\nonlyBuiltDependencies:\n  - esbuild\n' >> pnpm-workspace.yaml \
    && pnpm install --frozen-lockfile --registry="$NPM_REGISTRY" \
       --network-concurrency=8 --fetch-retries=3 --fetch-timeout=120000
COPY frontend/ ./
ARG VITE_AMAP_JS_KEY=""
ENV VITE_AMAP_JS_KEY=$VITE_AMAP_JS_KEY VITE_AMAP_SECURITY_CODE="" VITE_AMAP_SERVICE_HOST="/_AMapService" VITE_API_BASE=""
RUN pnpm build

FROM public.ecr.aws/docker/library/nginx:stable-alpine
COPY deploy/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
