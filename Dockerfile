# --- 构建阶段 ---
FROM node:20-alpine AS builder

WORKDIR /app

# 复制依赖清单并安装
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# 复制源码并编译
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# --- 运行阶段 ---
FROM node:20-alpine

WORKDIR /app

# 安装运行时依赖（better-sqlite3 需要 native 编译）
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# 移除构建工具以减小镜像体积
RUN apk del python3 make g++

# 复制编译产物
COPY --from=builder /app/dist/ dist/

# 创建数据目录
RUN mkdir -p /data

# 环境变量默认值
ENV PORT=8085
ENV DB_PATH=/data/wecom.db

EXPOSE 8085

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8085/healthz || exit 1

CMD ["node", "dist/index.js"]
