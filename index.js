const express = require('express')
const axios = require('axios');
var bodyParser = require('body-parser')
const app = express()
app.use(require('express-status-monitor')());
const mongo = require('mongodb').MongoClient
const url = 'mongodb://localhost:27017/mmEVRC'
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const https = require('https');
const http = require('http');
const bcrypt = require('bcrypt');
const fs = require('fs');
const emmVRCDLL = fs.readFileSync('webroot/downloads/emmVRC.dll', {encoding: 'base64'});
const rateLimit = require("express-rate-limit");
var checkerURL = 'http://127.0.0.1/checker'

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minutes
  max: 15, // limit each IP to 100 requests per windowMs
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
    const db = client.db('mmEVRC')
    const tokens = db.collection('tokens')
    const pins = db.collection('pins')
    const loginKeys = db.collection('loginKeys')
    const messages = db.collection('messages')
    const avatars = db.collection('avatars')
    const blocked = db.collection('blocked')

    setInterval(()=>{
        tokens.deleteMany({expires: {"$lt": Date.now()}}, (err, res)=>{

        })
        loginKeys.deleteMany({expires: {"$lt": Date.now()}}, (err, res)=>{

        })
    }, 3600000)


    app.use('/downloads', function(req, res, next) {
	console.log(`${req.ip} -- ${req.method} ${req.path}`)
	next();
    }, express.static('webroot/downloads'))

    app.use('/img', function(req, res, next) {
	console.log(`${req.ip} -- ${req.method} img${req.path}`)
	next();
    }, express.static('webroot/img'))

    app.use('/RiskyFuncsCheck.php', function(req, res) {
	console.log(`${req.ip} -- ${req.method} RiskyFuncsCheck.php`)
	res.send('allowed')
    });

    app.use('/BakaUpdate.php', function(req, res) {
	if(req.query.shouldload === ''){res.send('true'); console.log("Should Download")}
	if(req.query.libdownload === ''){res.send(emmVRCDLL); console.log("Sending main binary")}
	console.log(`${req.ip} -- ${req.method} BakaUpdate.php`)
    });

    app.use('/configuration.php', function(req, res) {
	console.log(`${req.ip} -- ${req.method} configuration.php`)
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
                tokens.updateOne({token: req.headers.authorization}, {$set: {expires: (Date.now() + 7200000)}})
                loginKeys.updateOne({userid: req.userid}, {"$set": {expires: (Date.now() + 7200000)}})
                next();
            })
        }else if(req.path=="/api/authentication/login"){
            console.log(`${req.body.name} -- ${req.method} ${req.path}`)
            next()
        }else{
            res.status(401).json({status: "Sorry Emm"});
        }
    })


     app.post(`/api/authentication/login`,limiter, (req, res)=>{
        console.log(req.body)
	axios.get(checkerURL + '/usrCheck?usrID=' + req.body.username).then(checkRes => {
		if (checkRes.data == "1") {
		console.log(req.body.username + ' exists, logging in');
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
                            tokens.updateOne({userid: req.body.username, username: req.body.name}, {'$set': {token: newToken, expires: (Date.now() + 600000), userIP: req.ip}}, {upsert: true}, (err, result)=>{
                                res.json({
                                    "token": newToken,
                                    "reset": true
                                });
                            })
                        }else{
                            bcrypt.hash(req.body.password,10, (err, hashedPin)=>{
                                pins.insertOne({userid: req.body.username, pin: hashedPin, username: req.body.name, userIP: req.ip}, ()=>{
                                    var newToken = crypto.randomBytes(32).toString('hex');
                                    tokens.updateOne({userid: req.body.username, username: req.body.name}, {'$set': {token: newToken, expires: (Date.now() + 600000)}}, {upsert: true}, (err, result)=>{
                                        res.json({
                                            "token": newToken,
                                            "reset": false
                                        });
                                    })
                                })
                            })
                        }
                    }else{
                        loginKeys.findOne({userid: req.body.username}, (err, loginKeyItem)=>{
                            bcrypt.compare(req.body.password, item.pin, (err, match)=>{
                                if(match){
                                    pins.updateOne({userid: req.body.username}, {$set: {username: req.body.name, userIP: req.ip}});
                                    var newToken = crypto.randomBytes(32).toString('hex');
                                    var loginKey = crypto.randomBytes(32).toString('hex');
                                    loginKeys.updateOne({userid: req.body.username}, {'$set': {loginKey: loginKey, expires: (Date.now() + 600000)}}, {upsert: true});
                                    tokens.updateOne({userid: req.body.username, username: req.body.name}, {'$set': {token: newToken, expires: (Date.now() + 600000)}}, {upsert: true}, (err, result)=>{
                                        res.json({
                                            "token": newToken,
                                            "loginKey": loginKey,
                                            "reset": false
                                        });
                                    })
                                }else if(loginKeyItem && loginKeyItem.loginKey == req.body.password){
                                    var newToken = crypto.randomBytes(32).toString('hex');
                                    var loginKey = crypto.randomBytes(32).toString('hex');
                                    loginKeys.updateOne({userid: req.body.username}, {'$set': {loginKey: loginKey, expires: (Date.now() + 600000)}}, {upsert: true});
                                    tokens.updateOne({userid: req.body.username, username: req.body.name}, {'$set': {token: newToken, expires: (Date.now() + 600000)}}, {upsert: true}, (err, result)=>{
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
                            console.log("pin")
                        })
                    }
                })
            }
        })
	}
	})
    })

    app.get(`/api/authentication/logout`, (req, res)=>{
	loginKeys.deleteOne({userid: req.userid});
        tokens.deleteOne({userid: req.userid});
        res.json({status: "OK"});
    })

    app.get(`/api/avatar`,limiter, (req, res)=>{
        avatars.find({users: {"$all": [req.userid]}}).toArray((err, items)=>{
            items.forEach(avatar=>{
                delete avatar.users;
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
            axios.get(checkerURL + '/aviCheck?aviID=' + req.body.avatar_id).then(checkRes => {
            	if(checkRes.data == "1") {
			console.log(req.body.avatar_id + ' is valid!');
	            avatars.find({'avatar_id': req.body.avatar_id}).toArray((err, item)=>{
	                if(item.length>0){
	                    console.log(`Avatar "${req.body.avatar_name}" exists, adding user "${req.username}" to the list!`)
	                    avatars.updateOne({'avatar_id': req.body.avatar_id}, {"$push": {users: req.userid}}, (err, result)=>{
	                    if(err){
	                        console.error(err);
	                        return res.json({"status": "ERR"})
	                    };
	                    res.json({"status": "OK"});
	                    })
	                }else{
	                    console.log(`Avatar "${req.body.avatar_name}" doesn't exist, adding!`)
	                    avatars.updateOne({'avatar_name': req.body.avatar_name, 'avatar_id': req.body.avatar_id, 'avatar_asset_url': req.body.avatar_asset_url, 'avatar_thumbnail_image_url': req.body.avatar_thumbnail_image_url, 'avatar_author_id': req.body.avatar_author_id, 'avatar_category': req.body.avatar_category, 'avatar_author_name': req.body.avatar_author_name, 'avatar_public': req.body.avatar_public, 'avatar_supported_platforms': req.body.avatar_supported_platforms}, {"$push": {users: req.userid}}, {upsert: true}, (err, result)=>{
	                    if(err) return res.json({"status": "ERR"});
	                        res.json({"status": "OK"});
	                    })
	                }
	            })
		}
	})
    })
    app.delete(`/api/avatar`, (req, res)=>{
        avatars.updateOne({'avatar_id': req.body.avatar_id}, {"$pull": {users: req.userid}}, (err, result)=>{
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
