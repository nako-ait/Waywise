FROM public.ecr.aws/docker/library/node:22-alpine AS build
WORKDIR /app
RUN npm install --global pnpm@10.8.1
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN printf '\nonlyBuiltDependencies:\n  - esbuild\n' >> pnpm-workspace.yaml \
    && pnpm install --frozen-lockfile
COPY frontend/ ./
ARG VITE_AMAP_JS_KEY=""
ARG VITE_AMAP_SECURITY_CODE=""
ENV VITE_AMAP_JS_KEY=$VITE_AMAP_JS_KEY VITE_AMAP_SECURITY_CODE=$VITE_AMAP_SECURITY_CODE VITE_API_BASE=""
RUN pnpm build

FROM public.ecr.aws/docker/library/nginx:stable-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
