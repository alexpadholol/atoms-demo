# Atoms-Demo — 单进程部署镜像
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN mkdir -p data workspace sites
EXPOSE 8787
ENV PORT=8787
CMD ["node", "server.js"]
