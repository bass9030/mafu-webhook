var express = require('express');
var router = express.Router();
// let reqlib = require('app-root-path').require;
const crypto = require('crypto');
const webhookManager = require('../utils/webhookManager');
var createError = require('http-errors');
const { getProfileURL, sendRecentTweet } = require('/utils/getTweet');
const { Webhook, MessageBuilder } = require('discord-webhook-node');

router.post('/register', async function(req, res, next) {
    let data = req.body;
    // console.log(data);
    if(!!!req.body && !!!req.body.url) {
        res.status(400).json({status: -99});
        return;
    }
    try {
        webhookManager.addWebhook(data.url)
        let embed = new MessageBuilder()
            .setTitle('마훅 구독 완료!')
            .setDescription('마훅 구독이 완료되었습니다!\n이제부터 마후마후 트윗을 한국어로 즐겨보세요!')
            .setColor('#1da1f2');
        let hook = new Webhook(data.url);
        hook.setUsername('마훅 - 마후 트윗 번역봇');
        hook.setAvatar((await getProfileURL()));
        await hook.send(embed);
        res.json({status: 0})
    }catch(e) {
        if(e.code == 'SQLITE_CONSTRAINT_UNIQUE') res.json({status: -2});
        else {
            webhookManager.removeWebhook(data.url)
            res.json({status: -1});
        }
    }
});

router.get('/count', (req, res) => {
    try {
        res.json({
            status: 0,
            data: webhookManager.getWebhookCount()
        });
    }catch{
        res.json({
            status: -1
        })
    }    
})

router.post('/unregister', (req, res, next) => {
    let data = req.body;
    if(!!!req.body && !!!req.body.url) {
        res.status(400).json({status: -99});
        return;
    }
    try {
        let changeCnt = webhookManager.removeWebhook(data.url).changes;
        if(changeCnt <= 0) throw new Error();
        res.json({status: 0})
    }catch(e) {
        res.json({status: -1})
    }
})

router.post('/sendNoti', (req, res, next) => {
    try {
        const hashedHeader = crypto.createHash('sha512').update(req.headers['authorization']).digest('hex')
        if(hashedHeader == process.env.NOTICE_TOKEN_KEY.toLowerCase()) {
            if(!!!req.body.content) {
                res.status(400).json({status: -1});
                return;
            }

            webhookManager.sendWebhook(req.body.content, )
        }else{
            res.status(403).json({status:-99});
        }    
    }catch(e) {
        res.status(500).json({status: -1})
    }
    
})

router.get('/testWebhook', (req, res, next) => {
    if(req.app.get('env') !== 'development') {
        next(createError(404));
        return;
    }
    sendRecentTweet();
    res.send('');
})

module.exports = router;