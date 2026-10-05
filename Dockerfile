FROM node:20-alpine AS build
RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev && npm cache clean --force

FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json /app/package-lock.json* ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/prisma ./prisma

CMD ["npm", "run", "docker-start"]
