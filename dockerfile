FROM node:20

WORKDIR /usr/src/app

ENV NODE_ENV=production

RUN apt-get update
RUN apt-get install git -y

RUN rm -rf ./*
RUN git clone -b production https://github.com/bass9030/mafu-webhook .

RUN npm install

EXPOSE 3000

CMD ["node", "./bin/www"]