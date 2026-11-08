FROM node:22-bookworm-slim
WORKDIR /app
ENV TZ=Asia/Kolkata
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
ENV PORT=3847
EXPOSE 3847
CMD ["node", "scripts/start.mjs"]
