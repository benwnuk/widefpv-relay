const http = require('http')
const path = require('path')
const express = require('express')
const WebSocketServer = require('ws').Server
const ffmpeg = require('ffmpeg-static')
const bindWsToFFMPEG = require('../rtmp/ws-ffmpeg.js')

const app = express()
const server = http.createServer(app).listen(process.env.PORT || 4001)

app.use(express.static(path.join(__dirname, '../dist')))

const wss = new WebSocketServer({ server })

bindWsToFFMPEG(wss, ffmpeg)
// bindWsToFFMPEG(wss)
console.log('ffmpeg socket service started')
