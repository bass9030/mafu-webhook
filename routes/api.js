var express = require('express');
var router = express.Router();
const webhookManager = require('../utils/webhookManager');

router.post('/register', function(req, res, next) {
    let data = req.data;
    webhookManager.addWebhook(data.url)
});

router.post('/unregister', (req, res, next) => {
    let data = req.data;
    webhookManager.removeWebhook(data.url)
})

module.exports = router;