import { createRequire } from 'module'
const require = createRequire(import.meta.url)

import childProcess from 'child_process' // To be used later for running FFmpeg
import { performance } from 'perf_hooks'
const { OpusEncoder } = require('@discordjs/opus')
import WideEvent from './WideEvent.js'

const MIN_STACK_START = 60

const TIMESTAMP_DELAY = 2e6
const AUDIO_PRE_GATE = 20000
const DATA_TIMEOUT = 10000

// const streamRegex = /Stream #0:0/i
const frameRegex = /frame=\s*(\d+) fps=\s*(\S+) q=-1.0 size=\s*(\d+)kB time=(\d+):(\d+):(\d+).(\d+) bitrate=\s*(\S+)kbits\/s speed=\s*(\S+)x/gm
const ioErrorRegex = /Error in the pull function/i

const Opus = new OpusEncoder(48000, 2)

const formatParams = (str) => {
  let resp
  resp = str.trim().replace(/\r?\n|\r/g, '').replace(/\\S+/g, ' ')
  resp = resp.split(' ')
  resp = resp.filter(e => e !== '' && e.length > 0)
  resp = resp.map(val => val.trim())
  console.log(str)
  return resp
}

const parseStats = (resp) => {
  // console.log('stats', resp)
  const data = []
  const out = []
  let m
  while ((m = frameRegex.exec(resp)) !== null) {
    if (m.index === frameRegex.lastIndex) { frameRegex.lastIndex++ }
    m.forEach((match, groupIndex) => data.push(match))
  }
  const val = pos => parseFloat(data[pos])
  if (data.length) {
    out.push('live')
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

export default class FFMPEG extends WideEvent {
  constructor (rtmpUrl, ffmpegPath) {
    super(true)
    this.ffmpegPath = ffmpegPath
    this.rtmpUrl = rtmpUrl
    this.state = 'empty' // empty, buffering, live, stopped
    this.started = false
    this.canStart = false
    this.gotVideoFrame = false
    this.width = 0
    this.height = 0
    this.stacks = {
      video: [],
      audio: []
    }
    this.timing = {
      startTime: 0,
      startTimestamp: 0,
      loop: false,
      timeoutTime: 0
    }
    const p = this.process = childProcess.spawn(this.ffmpegPath, 
      formatParams(`
      -fflags +genpts -stats_period 1 -hide_banner -use_wallclock_as_timestamps 1 -r 60
      -thread_queue_size 256 -i pipe:3 -f s16le -ar 48000 -ac 2
      -thread_queue_size 256 -i pipe:4
      -c:v copy -c:a aac -ar 48000 -ac 2 -b:a 96k -cutoff 18000
      -f flv -map 0:v -map 1:a -queue_size 60 -drop_pkts_on_overflow 0
      -attempt_recovery 1 -recovery_wait_time 1
      ${this.rtmpUrl}
      `),
      { stdio: ['pipe', 'ignore', 'pipe', 'pipe', 'pipe'] 
    }) // stdin, stdout, stderr, video, audio

    const onError = (msg, error) => {
      if (this.state !== 'stopped') {
        console.log('onError', error)
        this.$emitUpdate(this, { error: msg })
        this.stop()
      }
    }

    p.on('exit', (code) => {
      console.log('exit?', code)
      this.$emit('exit')
    })

    p.stdin.on('error', (err) => {
      onError('stream error', err)
    })

    p.stderr.on('data', (resp) => {
      if (this.state !== 'stopped') {
        resp = parseStats(resp.toString())
        resp && resp[0] === 'update' && this.$emit('update', resp[1])
        resp && resp[0] === 'error' && onError(resp[1])
      }
    })
  }

  skip () {
    // burn stack until next keyframe
    const s = this.stacks
    let timestamp
    for (let i = 0; i < s.video.length; i ++) {
      if (s.video[i].type = 'key') {
        timestamp = s.video[i].timestamp
        break
      }
    }
    if (timestamp) {
      s.video = s.video.filter(frame => frame.timestamp >= timestamp)
      s.audio = s.audio.filter(frame => frame.timestamp >= timestamp)
    }
  }

  feed (chunk) {
    const t = this.timing
    t.timeoutTime = performance.now() + DATA_TIMEOUT
    if (chunk.medium === 'video') {
      this.stacks.video.push(chunk)
      this.gotVideoFrame = true
    } else if (this.gotVideoFrame) {
      this.stacks.audio.push(chunk)
    }
    if (this.gotVideoFrame && this.state === 'empty') {
      this.$emitUpdate(this, { state: 'buffering'})
    }
    this.checkIfCanStart()
  }

  checkIfCanStart () {
    if (!this.started && this.canStart && this.stacks.video.length > MIN_STACK_START) {
      this.start()
    }
  }

  setCanStart () {
    this.canStart = true
    this.checkIfCanStart()
  }

  start () {
    const t = this.timing
    const s = this.stacks
    const p = this.process
    clearInterval(t.loop)
    // console.log(this.stacks)
    if (!s.video.length) {
      // console.log('cant start with empty stack')
      return false
    }
    this.skip()
    t.startTime = performance.now()
    t.startTimestamp = s.video[0].timestamp
    this.$emitUpdate(this, { started: true })
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
      // console.log(s.video.length, s.audio.length)
      if (this.state === 'stopped') {
        clearInterval(t.loop)
      } else if (t.timeoutTime < performance.now()) {
        this.$emit('timeout')
        this.stop()
      } else {
        const vEntry = testStack(s.video, gateTimestamp)
        vEntry && p.stdio[3].write(vEntry.data)
        const aEntry = testStack(s.audio, gateTimestamp + AUDIO_PRE_GATE)
        if (aEntry) {
          const pcm = Opus.decode(aEntry.data)
          p.stdio[4].write(pcm)
        }
        if (vEntry || aEntry) {
          this.$emitUpdate(this, { state: 'live' })
        } else if (this.state === 'live' && !s.video.length && !s.audio.length) {
          this.$emitUpdate(this, { state: 'empty' })
        }
      }
    }
    t.loop = setInterval(onLoop, 4)
  }

  stop () {
    clearInterval(this.timing.loop)
    if (this.$emitUpdate(this, { state: 'stopped'})) {
      const p = this.process
      console.log('ffmpeg stop')
      try {
        setTimeout(() => {
          p.kill('SIGINT')
        }, 500)
        p.stdio[3].destroy()
        p.stdio[4].destroy()
      } catch (err) {
        console.log('stop err?', err)
      }
    }
  }
}
