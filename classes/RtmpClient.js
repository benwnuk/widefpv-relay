const WideEvent = require('../classes/WideEvent.js')
const PeercastUnpacker = require('../classes/PeercastUnpacker')
const childProcess = require('child_process') // To be used later for running FFmpeg
const { performance } = require('perf_hooks');
const { OpusEncoder } = require('@discordjs/opus');
let ffmpegPath
if (process.env.USE_FFMPEG_STATIC) {
  ffmpegPath = require('ffmpeg-static')
} else {
  ffmpegPath = 'ffmpeg'
}

const streamRegex = /Stream #0:0/i
const frameRegex = /frame=\s*(\d+) fps=\s*(\S+) q=-1.0 size=\s*(\d+)kB time=(\d+):(\d+):(\d+).(\d+) bitrate=\s*(\S+)kbits\/s speed=\s*(\S+)x/gm
const ioErrorRegex = /Error in the pull function/i

module.exports = class FFMPEG extends WideEvent {
  constructor(url, framerate) {
    super()
    this.unpacker = new PeercastUnpacker()
    this.opus = new OpusEncoder(48000, 2)
    this.ready = false
    this.stopped = false
    this.error = false
    this.rtmpUrl = url
    this.framerate = framerate
    this.stacks = {
      video: [],
      audio: []
    }
    this.timing = {
      startTime: 0,
      startTimestamp: 0,
      loop: false
    }
    this.process = false
  }

  startLoop () {
    const t = this.timing
    const s = this.stacks
    const p = this.process
    clearInterval(t.loop)
    const stacks = [s.video, s.audio]

    t.startTime
    const onLoop = () => {
      const elapsed = Math.floor((performance.now() - t.startTime) * 1000)
      const gateTimestamp = t.startTimestamp + elapsed - 2e6
      // console.log(elapsed, gateTimestamp)
      if (!this.stopped) {
        stacks.forEach((stack) => {
          const isAudio = stack === s.audio
          if (stack.length && stack[0].timestamp <= gateTimestamp) {
            const entry = stack.shift()
            if (isAudio) {
              const pcm = this.opus.decode(entry.data)
              p.stdio[4].write(pcm)
            } else {
              p.stdio[3].write(entry.data)
            }
          }
        })
      }
    }
    t.loop = setInterval(onLoop, 4)
  }

  formatParams (str) {
    let resp
    resp = str.trim().replace(/\r?\n|\r/g, '').replace(/\\S+/g, ' ')
    resp = resp.split(' ')
    resp = resp.filter(e => e !== '' && e.length > 0)
    resp = resp.map(val => val.trim())
    console.log(str)
    return resp
  }

  start () {
    const p = this.process = childProcess.spawn(ffmpegPath, 
      this.formatParams(`
      -fflags +genpts
      -stats_period 1
      -hide_banner
      -thread_queue_size 128
      -use_wallclock_as_timestamps 1
      -r ${this.framerate}
      -i pipe:3
      -f s16le -ar 48000 -ac 2
      -i pipe:4
      -c:v copy
      -c:a aac -ar 48000 -ac 2 -b:a 96k -cutoff 18000
      -f flv
      -map 0:v -map 1:a
      -queue_size 60
      -drop_pkts_on_overflow 0
      -attempt_recovery 1
      -recovery_wait_time 1
      ${this.rtmpUrl}
      `),
      { stdio: ['pipe', 'ignore', 'pipe', 'pipe', 'pipe'] 
    }) // stdin, stdout, stderr, video, audio

    p.on('exit', (code) => {
      this.$emitUpdate(this, { error: 'ffmpeg exit' })
      this.stop()
    })

    p.stdin.on('error', (err) => {
      console.log(err)
      this.$emitUpdate(this, { error: 'stream error' })
      this.stop()
    })

    p.stderr.on('data', (resp) => {
      // console.log(resp)
      !this.stopped && this.parseStats(resp.toString())
    })
  }

  feed (msg) {
    const t = this.timing
    // this.process && this.process.stdin.write(Uint8Array.from(msg))
    const payload = this.unpacker.unpack(Uint8Array.from(msg).buffer) 
    payload.chunks.forEach((chunk) => {
      this.stacks[chunk.medium].push(chunk)
      if (t.startTime === 0 && !this.stopped) {
        t.startTime = performance.now()
        t.startTimestamp = chunk.timestamp
        setTimeout(this.startLoop.bind(this), 500)
      }
    })
  }

  parseStats(resp) {
    console.log('stats', resp)
    if (this.stopped) {
      return
    }
    // console.log('FFmpeg STDERR:', resp)
    const data = []
    const out = []
    let m
    while ((m = frameRegex.exec(resp)) !== null) {
      if (m.index === frameRegex.lastIndex) { frameRegex.lastIndex++ }
      m.forEach((match, groupIndex) => data.push(match))
    }
    const val = pos => parseFloat(data[pos])
    if (!this.ready) {
      setTimeout(() => {
        !this.stopped && this.$emitUpdate(this, { ready: true })
      }, 1000)
    }
    if (data.length) {
      out.push('live')
      out.push(val(1))
      out.push(val(2))
      out.push(val(3))
      out.push((val(4) * 3600) + (val(5) * 60) + (val(6)))
      out.push(val(8))
      out.push(val(9))
      this.$emit('update', out.join(','))
    } else if (resp.match(streamRegex) && !this.ready) {
      this.$emitUpdate(this, { ready: true })
    } else if (resp.match(ioErrorRegex)) {
      this.$emitUpdate(this, { error: 'stream error' })
      this.stop()
    }
  }

  stop() {
    clearInterval(this.timing.loop)
    if (!this.stopped) {
      const p = this.process
      console.log('ffmpeg stop')
      this.$emitUpdate(this, { ready: false, stopped: true })
      try {
        p.stdio[3].destroy()
        p.stdio[4].destroy()
        setTimeout(() => {
          p.kill('SIGINT')
        }, 1000)
      } catch (err) {
        console.log('stop err?', err)
      }
    }
  }
}
