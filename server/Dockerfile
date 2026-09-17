# Node 22+ runs TypeScript directly via --experimental-strip-types, so there is
# no build step and no compiled output to keep in sync with the source.
FROM node:22-alpine

WORKDIR /app

# argon2 is a native module; it needs a toolchain to build on Alpine.
RUN apk add --no-cache python3 make g++

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
