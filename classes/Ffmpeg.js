import childProcess from 'child_process' // To be used later for running FFmpeg
import { performance } from 'perf_hooks'
import WideEvent from './WideEvent.js'

const DATA_TIMEOUT = 7000

const frameRegex = /frame=\s*(\d+) fps=\s*(\S+) q=-1.0 size=\s*(\d+)kB time=(\d+):(\d+):(\d+).(\d+) bitrate=\s*(\S+)kbits\/s speed=\s*(\S+)x/gm
const ioErrorRegex = /Error in the pull function|failed to read/i

const formatParams = (str) => {
  let resp
  resp = str.trim().replace(/\r?\n|\r/g, '').replace(/\\S+/g, ' ')
  resp = resp.split(' ')
  resp = resp.filter(e => e !== '' && e.length > 0)
  resp = resp.map(val => val.trim())
  console.log(str)
  return resp
}

export default class FFMPEG extends WideEvent {
  constructor (rtmpUrl, ffmpegPath) {
    super(true)
    this.ffmpegPath = ffmpegPath
    this.rtmpUrl = rtmpUrl
    this.state = 'empty' // empty, buffering, live, stopped
    this.lastFrameCount = 0
    this.started = false
    this.timeout = performance.now() + DATA_TIMEOUT
    const p = this.process = childProcess.spawn(this.ffmpegPath, 
      formatParams(`
      -stats_period 1 -hide_banner 
      -re
      -thread_queue_size 512 -i pipe:3
      -c:v copy -c:a copy
      -f flv -map 0:v -map 0:a 
      -queue_size 60 
      -drop_pkts_on_overflow 0
      -attempt_recovery 1 
      -recovery_wait_time 1
      ${this.rtmpUrl}
      `),
      { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] 
    }) // stdin, stdout, stderr, mpegts

    const onError = (msg, error) => {
      if (this.state !== 'stopped') {
        console.log('onError', error)
        this.$emitUpdate(this, { error: msg })
        this.stop()
      }
    }

    p.on('exit', (code) => {
      this.state = 'stopped'
      this.$emit('exit')
    })

    p.on('error', (code) => {
      onError('stream error', err)
    })

    p.stdout.on('error', (err) => {
      onError('stream error', err)
    })

    p.stderr.on('data', (resp) => {
      console.log(resp.toString())
      if (this.state !== 'stopped') {
        resp = this.parseStats(resp.toString())
        resp && resp[0] === 'update' && this.$emit('update', resp[1])
        resp && resp[0] === 'error' && onError(resp[1])
      }
    })
  }

  parseStats (resp) {
    // console.log('stats', resp)
    if (performance.now() > this.timeout) {
      this.$emit('timeout')
      this.stop()
      return
    }
    const data = []
    const out = []
    let m
    while ((m = frameRegex.exec(resp)) !== null) {
      if (m.index === frameRegex.lastIndex) { frameRegex.lastIndex++ }
      m.forEach((match, groupIndex) => data.push(match))
    }
    const val = pos => parseFloat(data[pos])
    if (data.length) {
      const frameCount = val(1)
      this.state = frameCount > this.lastFrameCount ? 'live' : 'stalled'
      out.push(this.state)
      out.push(val(1)) // frame num
      out.push(val(2)) // fps
      out.push(val(3)) // size
      out.push((val(4) * 3600) + (val(5) * 60) + (val(6))) // time
      out.push(val(8)) // bitrate
      out.push(val(9)) // speed
      return ['update', out.join(',')]
    } else if (resp.match(ioErrorRegex)) {
      return ['error', 'stream error']
    } else {
      return false
    }
  }

  feed (segment) {
    this.timeout = performance.now() + DATA_TIMEOUT
    this.process.stdio[3].write(segment)
  }

  start () {
    this.$emitUpdate(this, { started: true })
  }

  stop () {
    if (this.$emitUpdate(this, { state: 'stopped'})) {
      const p = this.process
      console.log('ffmpeg stop')
      try {
        setTimeout(() => {
          p.kill('SIGINT')
        }, 1000)
        p.stdio[3].destroy()
      } catch (err) {
        console.log('stop err?', err)
      }
    }
  }
}
