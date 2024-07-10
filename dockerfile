FROM node:20

WORKDIR /usr/src/app

ENV NODE_ENV=production

COPY ./package.json .
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "./bin/www"]