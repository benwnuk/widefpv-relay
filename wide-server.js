const qs = require('querystring')
const RtmpClient = require('./classes/RtmpClient.js')

const timeoutMinutes = 0.5
const toMS = timeoutMinutes * 60000


function bindWsToFFMPEG(wss) {
  wss.on('connection', (ws, req) => {
    const query = qs.parse(req.url.split('?').pop())

    if (query.fps && query.rtmp) {
      try {
        console.log(`FPS: ${query.fps}`)
        console.log(`RTMP: ${query.rtmp}`)
        let socketReady = true
        const client = new RtmpClient(query.rtmp, query.fps)

        let timeoutMS = Date.now() + toMS
        const onStartTimeout = () => {
          socketReady && ws.send('stopped,no activity')
          setTimeout(() => {
            socketReady && ws.close()
          }, 50)
        }
        let startTimeout = setTimeout(onStartTimeout, toMS)
        const clearStartTimeout = () => {
          startTimeout && clearTimeout(startTimeout)
          startTimeout = false
        }

        const socketStop = () => {
          console.log('socketStop')
          socketReady = false
          ws.terminate()
          clearStartTimeout()
        }

        const checkTimeout = () => {
          const now = Date.now()
          const timedOut = timeoutMS < now
          if (timedOut && socketReady) {
            ws.send('stopped,no activity')
            socketReady && setTimeout(socketStop, 50)
          }
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

        client.$on('update', (data) => {
          checkTimeout()
          socketReady && ws.send(data)
        })
        client.$on('error', (msg) => {
          ws.send(`error,${msg}`)
        })
        client.$on('ready', (state) => {
          console.log('onReady?', state, socketReady)
          if (state) {
            socketReady && ws.send('ready')
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
}

module.exports = bindWsToFFMPEG
