import { performance } from 'perf_hooks'
import WideEvent from './WideEvent.js'
import Ffmpeg from './Ffmpeg.js'

const ACTIVITY_TIMEOUT = 20000

export default class RtmpClient extends WideEvent {
  constructor(rtmpUrl, ffmpegPath) {
    super()
    this.ffmpegPath = ffmpegPath
    this.ready = true
    this.stopped = false
    this.error = false
    this.rtmpUrl = rtmpUrl
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
    this.start()
  }

  pingActivity () {
    this.timeout.time = performance.now() + ACTIVITY_TIMEOUT
  }

  start () {
    if (!this.ffmpeg) {
      const ff = this.ffmpeg = new Ffmpeg(this.rtmpUrl, this.ffmpegPath)
      ff.$on('error', (err) => {
        this.doError(err)
      })
      ff.$on('update', (update) => {
        !this.stopped && this.$emit('update', update)
      })
      ff.$on('exit', () => {
        this.stop()
      })
      ff.$on('timeout', () => {
        this.stop()
      })
    }
  }

  feed (msg) {
    // console.log('feed?', msg)
    this.ffmpeg && this.ffmpeg.feed(msg)
    this.pingActivity()
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
