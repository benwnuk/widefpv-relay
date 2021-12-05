import http from 'http'
import express  from 'express'
import { WebSocketServer } from 'ws'
import qs  from 'querystring'
import { lookpath } from 'lookpath'
import RtmpClient from './classes/RtmpClient.js'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const app = express()
const port = process.env.PORT || 4003
const server = http.createServer(app).listen(port)
const wss = new WebSocketServer({ server })

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

wss.on('connection', (ws, req) => {
  const query = qs.parse(req.url.split('?').pop())
  if (query.rtmp) {
    try {
      console.log(`RTMP: ${query.rtmp}`)
      let socketReady = true
      let client

      const send = (msg) => {
        // console.log('send:', msg)
        socketReady && ws.send(msg)
      }

      const sendAndClose = (msg) => {
        send(`stopped,${msg}`)
        setTimeout(socketStop, 50)
      }

      const socketStop = () => {
        if (socketReady) {
          console.log('socketStop')
          socketReady = false
          ws.terminate()
        }
      }

      if (sessions[query.rtmp]) {
        console.log('continue session')
        client = sessions[query.rtmp]
      } else {
        console.log('new session')
        client = sessions[query.rtmp] = new RtmpClient(query.rtmp, ffmpegPath)
      }

      send('ready')

      ws.on('message', (msg) => {
        // console.log(msg)
        client.feed(msg)
      })

      ws.on('close', (e) => {
        console.log('Socket  has closed')
        socketStop()
      })

      client.$on('update', (data) => {
        send(data)
      })

      client.$on('error', (msg) => {
        send(`error,${msg}`)
      })

      client.$on('stopped', (stopped) => {
        if (stopped) {
          sendAndClose('Encoder stopped')
          delete sessions[query.rtmp]
        }
      })

    } catch (err) {
      console.log('i can haz error?', err)
    }
  } else {
    console.log('no recognized params')
    ws.close()
  }
})

console.log(`ffmpeg socket service started, port:  ${port}`)