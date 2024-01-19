var express = require('express');
var router = express.Router();
const webhookManager = require('../utils/webhookManager');

router.post('/register', function(req, res, next) {
    let data = req.body;
    console.log(data);
    try {
        webhookManager.addWebhook(data.url)
        res.json({status: 0})
    }catch(e) {
        res.json({status: -1})
    }
});

router.post('/unregister', (req, res, next) => {
    let data = req.body;
    try {
        webhookManager.removeWebhook(data.url)
        res.json({status: 0})
    }catch(e) {
        res.json({status: -1})
    }
})

module.exports = router;