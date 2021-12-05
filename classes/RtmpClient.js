import { performance } from 'perf_hooks'
import { NoMuxUnpacker } from './NoMux.js'
import WideEvent from './WideEvent.js'
import Ffmpeg from './Ffmpeg.js'

const ACTIVITY_TIMEOUT = 20000

export default class RtmpClient extends WideEvent {
  constructor(rtmpUrl, ffmpegPath) {
    super()
    this.ffmpegPath = ffmpegPath
    this.unpacker = new NoMuxUnpacker()
    this.ready = true
    this.stopped = false
    this.error = false
    this.rtmpUrl = rtmpUrl
    this.conf = {
      width: 1280,
      height: 720,
      videoCodec: 'avc1.420034'
    }
    this.ffmpeg = false
    this.timeout = {
      time: performance.now() + ACTIVITY_TIMEOUT,
      timer: setInterval(() => {
        if (this.stopped) {
          clearInterval(this.timeout.timer)
        } else if (this.timeout.time < performance.now()) {
          this.doError('inactivity')
        }
      }, 2000)
    }

    this.unpacker.$on('chunk', (chunk) => {
      chunk.medium === 'video' && this.pingActivity()
      this.ffmpeg && this.ffmpeg.feed(chunk)
    })
    this.unpacker.$on('update', (conf) => {
      if (this.$emitUpdate(this.conf, {
        width: conf.width,
        height: conf.height,
        videoCodec: conf.videoCodec
      })) {
        console.log('unpacker update', this.conf)
        // this.start()
      }
      if (!this.ffmpeg) {
        this.start()
      }
    })
  }

  pingActivity () {
    this.timeout.time = performance.now() + ACTIVITY_TIMEOUT
  }

  replaceFfmpeg () {
    const ff = this.ffmpeg
    this.ffmpeg.$on('state', (state) => {
      state === 'empty' && ff.stop()
    })
    this.ffmpeg = false
  }

  start () {
    const existing = !!this.ffmpeg
    if (this.ffmpeg && this.ffmpeg.started) {
      this.replaceFfmpeg()
    }
    if (!this.ffmpeg) {
      const ff = this.ffmpeg = new Ffmpeg(this.rtmpUrl, this.ffmpegPath)
      ff.$on('error', (err) => {
        this.doError(err)
      })
      ff.$on('update', (update) => {
        !this.stopped && this.$emit('update', update)
      })
      ff.$on('exit', () => {
        this.ffmpeg && this.ffmpeg.setCanStart()
      })
      ff.$on('timeout', () => {
        this.stop()
      })
      !existing && this.ffmpeg.setCanStart()
    }
  }

  feed (msg) {
    this.unpacker.feed(Uint8Array.from(msg).buffer)
  }

  doError (msg) {
    this.$emitUpdate(this, { error: msg })
    this.stop()
  }

  stop() {
    clearInterval(this.timeout.timer)
    if (this.ffmpeg && !this.stopped) {
      this.ffmpeg.stop()
      this.$emitUpdate(this, { ready: false, stopped: true })
    }
  }
}
