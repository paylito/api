FROM node:24-alpine

COPY package.json package-lock.json /app/
WORKDIR /app

RUN npm i

COPY . /app/

RUN npm run build

EXPOSE 3000

CMD ["node", "dist/src/index.js"]
