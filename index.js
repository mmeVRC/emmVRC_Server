const express = require('express')
var bodyParser = require('body-parser')
const app = express()
app.use(require('express-status-monitor')());
const mongo = require('mongodb').MongoClient
const url = 'mongodb://localhost:27017/mmeVRC'
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const https = require('https');
const http = require('http');
const fs = require('fs');
const emmVRCDLL = fs.readFileSync('webroot/downloads/emmVRC.dll', {encoding: 'base64'});
const rateLimit = require("express-rate-limit");

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minutes
  max: 10, // limit each IP to 100 requests per windowMs
  message: '{status: "Rate-limited"}'
});

mongo.connect(url, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  }, (err, client) => {
  if (err) {
    console.error(err)
    return
  }
    const db = client.db('emmVRC')
    const tokens = db.collection('tokens')
    const pins = db.collection('pins')
    const loginKeys = db.collection('loginKeys')
    const messages = db.collection('messages')
    const avatars = db.collection('avatars')
    const blocked = db.collection('blocked')

    app.use('/downloads', function(req, res, next) {
	console.log(`${req.username} -- ${req.method} ${req.path}`)
	next();
    }, express.static('webroot/downloads'))

    app.use('/img', function(req, res, next) {
	console.log(`${req.username} -- ${req.method} img${req.path}`)
	next();
    }, express.static('webroot/img'))

    app.use('/RiskyFuncsCheck.php', function(req, res) {
	console.log(`${req.username} -- ${req.method} RiskyFuncsCheck.php`)
	res.send('allowed')
    });

    app.use('/BakaUpdate.php', function(req, res) {
	if(req.query.shouldload === ''){res.send('true')}
	if(req.query.libdownload === ''){res.send(emmVRCDLL)}
	console.log(`${req.username} -- ${req.method} BakaUpdate.php`)
    });

    app.use('/configuration.php', function(req, res) {
	console.log(`${req.username} -- ${req.method} configuration.php`)
	res.send('{ "MessageUpdateRate": 10, "DisableAuthFile": false, "DeleteAndDisableAuthFile": false, "DisableAvatarChecks": true, "APICallsAllowed": true }')
    });


    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({extended: false}));

    app.use(function (req, res, next) {
        if(req.headers.authorization){
            req.headers.authorization = req.headers.authorization.replace("Bearer ", "");
            tokens.findOne({token: req.headers.authorization}, (err, item)=>{
                if(err || !item) return res.status(401).json({status: "Sorry Emm"});
                req.userid = item.userid;
                req.username = item.username
		if(req.path != "/api/message"){
              	  console.log(`${req.username} -- ${req.method} ${req.path}`)
		}
                next();
            })
        }else if(req.path=="/api/authentication/login"){
            console.log(`${req.body.name} -- ${req.method} ${req.path}`)
            next()
        }else{
            res.status(401).json({status: "Sorry Emm"});
        }
    })


     app.post(`/api/authentication/login`, (req, res)=>{
        console.log(req.body)
        blocked.findOne({userid: req.body.username}, (err, item)=>{
            if(item){
                console.log("user is blocked!");
                return res.status(401).json({message: "forbidden"});
            }else{
                pins.findOne({userid: req.body.username}, (err, item)=>{
                    if(!item){
                        console.log("no pin")
                        if(req.body.password==req.body.username){
                            var newToken = crypto.randomBytes(32).toString('hex');
                            tokens.updateOne({userid: req.body.username, username: req.body.name}, {'$set': {token: newToken}}, {upsert: true}, (err, result)=>{
                                res.json({
                                    "token": newToken,
                                    "reset": true
                                });
                            })
                        }else{
                            pins.insertOne({userid: req.body.username, pin: req.body.password}, ()=>{
                                var newToken = crypto.randomBytes(32).toString('hex');
                                tokens.updateOne({userid: req.body.username, username: req.body.name}, {'$set': {token: newToken}}, {upsert: true}, (err, result)=>{
                                    res.json({
                                        "token": newToken,
                                        "reset": false
                                    });
                                })
                            })
                        }
                    }else{
                        loginKeys.findOne({userid: req.body.username}, (err, loginKeyItem)=>{
                            console.log("pin")
                            if(item.pin == req.body.password){
                                var newToken = crypto.randomBytes(32).toString('hex');
                                var loginKey = crypto.randomBytes(32).toString('hex');
                                loginKeys.updateOne({userid: req.body.username}, {'$set': {loginKey: loginKey}}, {upsert: true});
                                tokens.updateOne({userid: req.body.username, username: req.body.name}, {'$set': {token: newToken}}, {upsert: true}, (err, result)=>{
                                    res.json({
                                        "token": newToken,
                                        "loginKey": loginKey,
                                        "reset": false
                                    });
                                })
                            }else if(loginKeyItem && loginKeyItem.loginKey == req.body.password){
                                var newToken = crypto.randomBytes(32).toString('hex');
                                var loginKey = crypto.randomBytes(32).toString('hex');
                                loginKeys.updateOne({userid: req.body.username}, {'$set': {loginKey: loginKey}}, {upsert: true});
                                tokens.updateOne({userid: req.body.username, username: req.body.name}, {'$set': {token: newToken}}, {upsert: true}, (err, result)=>{
                                    res.json({
                                        "token": newToken,
                                        "loginKey": loginKey,
                                        "reset": false
                                    });
                                })
                            }else{
                                console.log("invalid combination")
                                res.status(401).json({message: "invalid combination"})
                            }
                        })
                    }
                })
            }
        })
    })

    app.get(`/api/authentication/logout`, (req, res)=>{
        tokens.deleteOne({userid: req.userid});
        res.json({status: "OK"});
    })

    app.get(`/api/avatar`,limiter, (req, res)=>{
        avatars.find({userid: req.userid}).toArray((err, items)=>{
            items.forEach(avatar=>{
                delete avatar.userid;
                avatar.avatar_name = Buffer.from(avatar.avatar_name).toString("base64");
                avatar.avatar_author_name = Buffer.from(avatar.avatar_author_name).toString("base64");
            })
            res.json(items);
        })
    })

    app.post(`/api/avatar/search`,limiter, (req, res)=>{
        avatars.find({'$or': [{'avatar_author_name': new RegExp(req.body.query, 'i')}, {'avatar_name': new RegExp(req.body.query, 'i')}]}).limit(150).toArray((err,items)=>{
            items.forEach(avatar=>{
                delete avatar.userid;
                avatar.avatar_name = Buffer.from(avatar.avatar_name).toString("base64");
                avatar.avatar_author_name = Buffer.from(avatar.avatar_author_name).toString("base64");
            })
            res.json(items);
            //console.log(JSON.stringify(items, null, 2))
        })
    })

    app.post(`/api/avatar`,limiter, (req, res)=>{
	if(req.body.avatar_asset_url.startsWith('https://api.vrchat.cloud/') && req.body.avatar_thumbnail_image_url.startsWith('https://api.vrchat.cloud/') || req.body.avatar_asset_url.startsWith('https://files.vrchat.cloud/') && req.body.avatar_thumbnail_image_url.startsWith('https://files.vrchat.cloud/')) {
        	avatars.insertOne({'avatar_name': req.body.avatar_name, 'avatar_id': req.body.avatar_id, 'avatar_asset_url': req.body.avatar_asset_url, 'avatar_thumbnail_image_url': req.body.avatar_thumbnail_image_url, 'avatar_author_id': req.body.avatar_author_id, 'avatar_category': req.body.avatar_category, 'avatar_author_name': req.body.avatar_author_name, 'avatar_public': req.body.avatar_public, 'avatar_supported_platforms': req.body.avatar_supported_platforms, userid: req.userid}, (err, result)=>{
        	    if(err) return res.json({"status": "ERR"});
        	    res.json({"status": "OK"});
        	})
        }
    })

    app.delete(`/api/avatar`, (req, res)=>{
        avatars.deleteOne({userid: req.userid, 'avatar_id': req.body.avatar_id}, (err, result)=>{
            if(err) return res.json({"status": "ERR"});
            res.json({"status": "OK"});
        })
    })

    app.post(`/api/message`,limiter, (req, res)=>{
        var messageId = uuidv4();
        messages.insertOne({sentTo: req.body.recipient, 'rest_message_id': messageId, 'rest_message_sender_name': req.username, 'rest_message_sender_id': req.userid, rest_message_body: req.body.body, 'rest_message_created': Math.floor(Date.now() / 1000), 'rest_message_icon': "none"}, (err, result)=>{
            if(err) res.json({status: "ERR"});
            res.json({status: "OK"});
        })
        })

    app.get(`/api/message`, (req, res)=>{
        messages.find({sentTo: req.userid}).toArray((err, items)=>{
            items.forEach(message=>{
                delete message._id;
                delete message.sentTo;
                message.rest_message_sender_name = Buffer.from(message.rest_message_sender_name).toString("base64")
                message.rest_message_body = Buffer.from(message.rest_message_body).toString("base64")
            })
            res.json(items)
        })
    })

    app.patch(`/api/message/:id`, (req, res)=>{
        messages.deleteOne({rest_message_id: req.params.id}, (eer, result)=>{
            if(err) res.json({status: "ERR"});
            res.json({status: "OK"});
        })
    })


const httpServer = http.createServer(app);
const httpsServer = https.createServer({
  key: fs.readFileSync('/etc/letsencrypt/live/{YOUR_DOMAIN}/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/{YOUR_DOMAIN}/fullchain.pem'),
}, app);

const httpsDownloadServer = https.createServer({
  key: fs.readFileSync('/etc/letsencrypt/live/{YOUR_DOMAIN}/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/{YOUR_DOMAIN}/fullchain.pem'),
}, app);

httpsServer.listen(3000, () => {
    console.log('mmEServer running on port 3000');
});

httpServer.listen(80, () => {
    console.log('mmEWeb running on port 80');
});


httpsDownloadServer.listen(443, () => {
    console.log('mmEDownload running on port 443');
});

})
