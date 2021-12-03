const WideEvent = require('./WideEvent.js')
const PeercastUnpacker = require('./PeercastUnpacker')
const childProcess = require('child_process') // To be used later for running FFmpeg
const { performance } = require('perf_hooks');
const { OpusEncoder } = require('@discordjs/opus');

const TIMESTAMP_DELAY = 4e6
const AUDIO_PRE_GATE = 20000

const streamRegex = /Stream #0:0/i
const frameRegex = /frame=\s*(\d+) fps=\s*(\S+) q=-1.0 size=\s*(\d+)kB time=(\d+):(\d+):(\d+).(\d+) bitrate=\s*(\S+)kbits\/s speed=\s*(\S+)x/gm
const ioErrorRegex = /Error in the pull function/i

module.exports = class RtmpClient extends WideEvent {
  constructor(rtmpUrl, ffmpegPath) {
    super()
    this.ffmpegPath = ffmpegPath
    this.unpacker = new PeercastUnpacker()
    this.opus = new OpusEncoder(48000, 2)
    this.ready = false
    this.stopped = false
    this.error = false
    this.rtmpUrl = rtmpUrl
    this.stacks = {
      video: [],
      audio: []
    }
    this.timing = {
      startTime: 0,
      startTimestamp: 0,
      loop: false,
      timeoutTime: false
    }
    this.process = false
  }

  startLoop () {
    const t = this.timing
    const s = this.stacks
    const p = this.process
    clearInterval(t.loop)
    const testStack = (stack, timestamp) => {
      if (stack.length && stack[0].timestamp <= timestamp) {
        return stack.shift()
      }
      return false
    }

    const onLoop = () => {
      const t = this.timing
      const elapsed = Math.floor((performance.now() - t.startTime) * 1000)
      const gateTimestamp = t.startTimestamp + elapsed - TIMESTAMP_DELAY
      // console.log(elapsed, gateTimestamp)
      if (!this.stopped) {
        if (t.timeoutTime < performance.now()) {
          this.stop()
        } else {
          const vEntry = testStack(s.video, gateTimestamp)
          vEntry && p.stdio[3].write(vEntry.data)
          const aEntry = testStack(s.audio, gateTimestamp + AUDIO_PRE_GATE)
          if (aEntry) {
            const pcm = this.opus.decode(aEntry.data)
            p.stdio[4].write(pcm)
          }
        }
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
    const p = this.process = childProcess.spawn(this.ffmpegPath, 
      this.formatParams(`
      -fflags +genpts
      -stats_period 1
      -hide_banner
      -use_wallclock_as_timestamps 1
      -r 60
      -thread_queue_size 256
      -i pipe:3
      -f s16le -ar 48000 -ac 2
      -thread_queue_size 256
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
      this.doError('ffmpeg exit' )
    })

    p.stdin.on('error', (err) => {
      console.log(err)
      this.doError('stream error' )
    })

    p.stderr.on('data', (resp) => {
      // console.log(resp)
      !this.stopped && this.parseStats(resp.toString())
    })
  }

  feed (msg) {
    const t = this.timing
    const payload = this.unpacker.unpack(Uint8Array.from(msg).buffer) 
    payload.chunks.forEach((chunk) => {
      t.timeoutTime = performance.now() + 10000
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
        !this.stopped && this.emitUpdate(this, { ready: true })
      }, 1000)
    }
    if (data.length) {
      out.push('live')
      out.push(val(1)) // frame num
      out.push(val(2)) // fps
      out.push(val(3)) // size
      out.push((val(4) * 3600) + (val(5) * 60) + (val(6))) // time
      out.push(val(8)) // bitrate
      out.push(val(9)) // speed
      const s = this.stacks
      out.push(s.video.length + s.audio.length) // stack size
      this.emit('update', out.join(','))
    } else if (resp.match(streamRegex) && !this.ready) {
      this.emitUpdate(this, { ready: true })
    } else if (resp.match(ioErrorRegex)) {
      this.doError('stream error' )
    }
  }

  doError (msg) {
    this.emitUpdate(this, { error: msg })
    this.stop()
  }

  stop() {
    clearInterval(this.timing.loop)
    if (!this.stopped) {
      const p = this.process
      console.log('ffmpeg stop')
      this.emitUpdate(this, { ready: false, stopped: true })
      try {
        setTimeout(() => {
          p.kill('SIGINT')
        }, 2000)
        p.stdio[3].destroy()
        p.stdio[4].destroy()
      } catch (err) {
        console.log('stop err?', err)
      }
      this.off()
    }
  }
}
