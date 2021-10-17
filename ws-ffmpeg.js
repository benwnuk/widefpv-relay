const childProcess = require('child_process') // To be used later for running FFmpeg
const qs = require('querystring')

const streamRegex = /Stream #0:0/i
const frameRegex = /frame=\s*(\d+) fps=\s*(\S+) q=-1.0 size=\s*(\d+)kB time=(\d+):(\d+):(\d+).(\d+) bitrate=\s*(\S+)kbits\/s speed=\s*(\S+)x/gm
const ioErrorRegex = /Error in the pull function/i
const timeoutMinutes = 0.5
const toMS = timeoutMinutes * 60000

const tempRTMP = {
  value: 'x',
  timer: false
}

const setTempRTMP = (rtmp) => {
  console.log('rtmp set', rtmp)
  tempRTMP.timer && clearTimeout(tempRTMP.timer)
  tempRTMP.value = rtmp
  tempRTMP.timer = setTimeout(() => {
    tempRTMP.value = 'x'
  }, 5000)
}

const getTempRTMP = () => {
  console.log('rtmp fetch', tempRTMP.value)
  tempRTMP.timer && clearTimeout(tempRTMP.timer)
  const val = tempRTMP.value
  tempRTMP.value = 'x'
  return val
}

function bindWsToFFMPEG (wss, ffmpegPath = 'ffmpeg') {
  wss.on('connection', (ws, req) => {
    const query = qs.parse(req.url.split('?').pop())
    // console.log(`FPS: ${query.fps}`)
    // console.log(`RTMP: ${query.rtmp}`)
    // console.log(`POST: ${query.post}`)
    // console.log(`FETCH: ${query.fetch}`)
    if (query.post) {
      console.log(`POST: ${query.post}`)
      setTempRTMP(query.rtmp)
      ws.close()
      return
    } else if (query.fetch) {
      const val = getTempRTMP()
      console.log(`FETCH: ${val}`)
      ws.send(val)
      ws.close()
      return
    } else if (!query.fps || !query.rtmp) {
      ws.close()
    }
    let ffmpeg
    try {
      console.log(`FPS: ${query.fps}`)
      console.log(`RTMP: ${query.rtmp}`)
      let socketReady = true
      let ffmpegReady = false
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
      const ffmpegStop = () => {
        if (ffmpegReady) {
          ffmpegReady = false
          console.log('ffmpeg stop')
          try {
            ffmpeg.stdin.write('q\r\n')
            setTimeout(() => {
              ffmpeg.kill('SIGKILL')
            }, 200)
          } catch (err) {
            console.log('stop err?', err)
          }
        }
      }

      const socketStop = () => {
        socketReady = false
        ws.terminate()
        clearStartTimeout()
      }

      const parseStats = (resp) => {
        resp = resp.toString()
        console.log('FFmpeg STDERR:', resp)
        const data = []
        const out = []
        let m
        while ((m = frameRegex.exec(resp)) !== null) {
          if (m.index === frameRegex.lastIndex) { frameRegex.lastIndex++ }
          m.forEach((match, groupIndex) => data.push(match))
        }
        const val = pos => parseFloat(data[pos])
        const now = Date.now()

        const timedOut = timeoutMS < now

        if (timedOut && socketReady) {
          ws.send('stopped,no activity')
          socketReady && setTimeout(socketStop, 50)
        } else if (data.length) {
          out.push('live')
          out.push(val(1))
          out.push(val(2))
          out.push(val(3))
          out.push((val(4) * 3600) + (val(5) * 60) + (val(6)))
          out.push(val(8))
          out.push(val(9))
          out.push(Math.round((timeoutMS - now) / 1000))
          socketReady && ws.send(out.join(','))
        } else if (resp.match(streamRegex) && !ffmpegReady) {
          console.log('ready')
          ffmpegReady = true
          ws.send('ready')
        } else if (resp.match(ioErrorRegex)) {
          ws.send('error,stream error')
          ffmpegStop()
        }
      }

      ffmpeg = childProcess.spawn(ffmpegPath, [
        //  '-hide_banner',
        '-stats_period', '1',
        '-f', 'lavfi', '-i', 'anullsrc',
        '-thread_queue_size', '512',
        '-use_wallclock_as_timestamps', '1',
        '-r', `${query.fps}`,
        '-i', '-',
        '-shortest',
        '-vcodec', 'copy',
        '-acodec', 'aac',
        '-f', 'flv',
        query.rtmp
      ])

      ffmpeg.on('exit', (code) => {
        ffmpegReady = false
        console.log('FFmpeg child process exit, code ' + code)
        socketStop()
      })

      ffmpeg.stdin.on('error', function (err) {
        if (err.code === 'EPIPE') {
          ws.send('error,stream error')
          ffmpegStop()
          socketStop()
        }
      })

      ffmpeg.stderr.on('data', (resp) => {
        parseStats(resp)
      })

      ws.on('message', (msg) => {
        ffmpegReady && ffmpeg.stdin.write(msg)
        timeoutMS = Date.now() + toMS
        clearStartTimeout()
      })

      ws.on('close', (e) => {
        console.log('Socket  has closed')
        socketStop()
        ffmpegStop()
      })
    } catch (err) {
      console.log('any better?', err)
    }
  })
}

module.exports = bindWsToFFMPEG
