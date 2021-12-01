const http = require('http')
const express = require('express')
const WebSocketServer = require('ws').Server
const qs = require('querystring')
const RtmpClient = require('./classes/RtmpClient.js')
const app = express()
const port = process.env.PORT || 4003
const server = http.createServer(app).listen(port)
const wss = new WebSocketServer({ server })
const { lookpath } = require('lookpath')
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
html,body { width: 100%; height: 100%; }
body { background: black; color: white; display: flex; align-items: center; justify-content: center; }
p { font-family: Arial, Helvetica, sans-serif; font-size: 24px; text-align: center; }
</style></head><body><p>WideFPV<br> Relay Host</p></body></html>
`
app.get("/", (req, res) => { res.send(indexHtml) })

const timeoutMinutes = 0.5
const toMS = timeoutMinutes * 60000

wss.on('connection', (ws, req) => {
  const query = qs.parse(req.url.split('?').pop())
  if (query.rtmp) {
    try {
      console.log(`RTMP: ${query.rtmp}`)
      let socketReady = true
      const client = new RtmpClient(query.rtmp, ffmpegPath)

      const send = (msg) => {
        socketReady && ws.send(msg)
      }

      const sendAndClose = (msg) => {
        send('stopped,no activity')
        setTimeout(() => {
          socketReady && ws.close()
        }, 50)
      }

      let timeoutMS = Date.now() + toMS
      const onStartTimeout = () => {
        sendAndClose('stopped,no activity')
      }
      let startTimeout = setTimeout(onStartTimeout, toMS)
      const clearStartTimeout = () => {
        startTimeout && clearTimeout(startTimeout)
        startTimeout = false
      }

      const socketStop = () => {
        if (socketReady) {
          console.log('socketStop')
          socketReady = false
          ws.terminate()
          clearStartTimeout()
        }
      }

      const checkTimeout = () => {
        const now = Date.now()
        const timedOut = timeoutMS < now
        timedOut && sendAndClose('stopped,no activity')
      }

      ws.on('message', (msg) => {
        client.ready && client.feed(msg)
        timeoutMS = Date.now() + toMS
        clearStartTimeout()
      })

      ws.on('close', (e) => {
        console.log('Socket  has closed')
        socketStop()
        client.stop()
      })

      client.on('update', (data) => {
        checkTimeout()
        send(data)
      })
      client.on('error', (msg) => {
        send(`error,${msg}`)
      })
      client.on('ready', (state) => {
        console.log('onReady?', state, socketReady)
        if (state && socketReady) {
          send('ready')
        } else {
          socketStop()
        }
      })
      client.start()
    } catch (err) {
      console.log('i can haz error?', err)
    }
  } else {
    console.log('no recognized params')
    ws.close()
  }
})

console.log(`ffmpeg socket service started, port: ${port}`)