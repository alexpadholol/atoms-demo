# Atoms-Demo — 单进程部署镜像
# 注意：better-sqlite3 是原生模块，预编译二进制面向 glibc，
#       必须用 slim（Debian）而非 alpine（musl），否则后端无法启动。
FROM node:22-slim

WORKDIR /app

# 若预编译二进制缺失则用系统构建工具从源码编译
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# 运行时目录（SQLite / 产物）
RUN mkdir -p data workspace sites

EXPOSE 8787
ENV PORT=8787
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
