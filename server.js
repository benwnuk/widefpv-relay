import http from 'http'
import express  from 'express'
import { WebSocketServer } from 'ws'
import { lookpath } from 'lookpath'
import RtmpClient from './classes/RtmpClient.js'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const app = express()
const port = process.env.PORT || 4003
const server = http.createServer(app).listen(port)
const wss = new WebSocketServer({ server })
require('dotenv').config()

let ffmpegPath = 'ffmpeg'
const initFfmpegPath = async () => {
  const inPath = await lookpath('ffmpeg')
  if (!inPath) {
    ffmpegPath = require('ffmpeg-static')
  }
}
initFfmpegPath()

const indexHtml = `
<!doctype html><html><head>
<meta charset="utf-8"><title>WideFPV Relay Host</title><style>
html,body { width: 100%; height: 100%; margin: 0; padding: 0; }
body { background: black; color: white; display: flex; align-items: center; justify-content: center; }
p { font-family: Arial, Helvetica, sans-serif; font-size: 24px; text-align: center; }
</style></head><body><p>WideFPV<br> Relay Host</p></body></html>
`
app.get("/", (req, res) => { res.send(indexHtml) })

const sessions = {}

const hostParams = {
  password: process.env.USER_PASSWORD || false,
  super: process.env.SUPER_PASSWORD || false,
  bitrateLimit: process.env.BITRATE_LIMIT || 4,
  sessionLimit: process.env.SESSION_LIMIT || false,
  userLimit: process.env.USER_LIMIT || 6
}

wss.on('connection', (ws, req) => {
  try {
    let socketReady = true
    let client

    const send = (msg) => {
      // console.log('send:', msg)
      socketReady && ws.send(msg)
    }
    const socketStop = () => {
      if (socketReady) {
        console.log('socketStop')
        socketReady = false
        ws.terminate()
      }
    }
    const sendAndClose = (msg) => {
      send(`stopped,${msg}`)
      setTimeout(socketStop, 50)
    }

    const initClient = (rtmp) => {
      if (sessions[rtmp]) {
        console.log('continue session')
        client = sessions[rtmp]
        client.$off()
      } else {
        console.log('new session')
        client = sessions[rtmp] = new RtmpClient(rtmp, ffmpegPath)
      }
      client.$on('update', (data) => {
        send(data)
      })
      client.$on('error', (msg) => {
        send(`error,${msg}`)
      })
      client.$on('stopped', (stopped) => {
        if (stopped) {
          sendAndClose('Encoder stopped')
          delete sessions[rtmp]
        }
      })
    }

    ws.on('message', (msg) => {
      if (client) {
        client.feed(msg)
      } else {
        const hp = hostParams
        msg = msg.toString().split(',')
        const cmd = msg[0]
        const pw = msg[1]
        const noPass = !hp.password && !hp.super
        const isUser = hp.password && pw === hp.password
        const isSuper = hp.super && pw === hp.super
        const userCount = Object.keys(sessions).length
        const rtmp = msg[2]
        if (cmd === 'start') {
          if (!noPass && !isUser && !isSuper) {
            sendAndClose('Bad Password')
          } else if (!rtmp) {
            sendAndClose('Missing RTMP')
          } else if (!isSuper && userCount >= hp.userLimit) {
            sendAndClose('User Limit')
          } else {
            if (noPass || isUser) {
              send(`ready,${hp.bitrateLimit},${hp.sessionLimit}`)
            } else {
              send(`ready,0,0`)
            }
            console.log(`RTMP: ${rtmp}`)
            initClient(rtmp)
          }
        } else {
          sendAndClose('Wrong Version')
        }
      }
    })

    ws.on('close', (e) => {
      console.log('Socket  has closed')
      socketStop()
    })

  } catch (err) {
    console.log('i can haz error?', err)
  }

})

console.log(`ffmpeg socket service started, port:  ${port}`)