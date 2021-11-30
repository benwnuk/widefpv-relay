const http = require('http')
const path = require('path')
const express = require('express')
const WebSocketServer = require('ws').Server
const wideServer = require('./wide-server.js')

const app = express()
const port = process.env.PORT || 4003
const server = http.createServer(app).listen(port)

app.use(express.static(path.join(__dirname, 'site')))

const wss = new WebSocketServer({ server })
wideServer(wss)

console.log(`ffmpeg socket service started, port: ${port}`)