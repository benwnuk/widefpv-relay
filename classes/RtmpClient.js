const WideEvent = require('../classes/WideEvent.js')
const childProcess = require('child_process') // To be used later for running FFmpeg
// const ffmpegPath = require('ffmpeg-static')
const ffmpegPath = 'ffmpeg'

const streamRegex = /Stream #0:0/i
const frameRegex = /frame=\s*(\d+) fps=\s*(\S+) q=-1.0 size=\s*(\d+)kB time=(\d+):(\d+):(\d+).(\d+) bitrate=\s*(\S+)kbits\/s speed=\s*(\S+)x/gm
const ioErrorRegex = /Error in the pull function/i

module.exports = class FFMPEG extends WideEvent {
  constructor(url, framerate) {
    super(true)
    this.ready = false
    this.error = false
    this.rtmpUrl = url
    this.framerate = framerate
    this.process = false
  }

  start() {
    const p = this.process = childProcess.spawn(ffmpegPath, [
      '-hide_banner',
      '-stats_period', '1',
      '-f', 'lavfi', '-i', 'anullsrc',
      '-thread_queue_size', '512',
      '-use_wallclock_as_timestamps', '1',
      '-r', `${this.framerate}`,
      '-i', '-',
      '-shortest',
      '-vcodec', 'copy',
      '-acodec', 'aac',
      '-f', 'flv',
      this.rtmpUrl
    ])
    p.on('exit', (code) => {
      this.$emitUpdate(this, { ready: false })
      console.log('FFmpeg child process exit, code ' + code)
    })

    p.stdin.on('error', (err) => {
      if (err.code === 'EPIPE') {
        this.$emitUpdate(this, { error: 'stream error' })
        this.stop()
      }
    })

    p.stderr.on('data', (resp) => {
      this.parseStats(resp.toString())
    })
  }

  feed(msg) {
    this.ready && this.process.stdin.write(msg)
  }

  parseStats(resp) {
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

    if (data.length) {
      out.push('live')
      out.push(val(1))
      out.push(val(2))
      out.push(val(3))
      out.push((val(4) * 3600) + (val(5) * 60) + (val(6)))
      out.push(val(8))
      out.push(val(9))
      // out.push(Math.round((timeoutMS - now) / 1000))
      this.$emit('update', out.join(','))
    } else if (resp.match(streamRegex) && !this.ready) {
      this.$emitUpdate(this, { ready: true })
    } else if (resp.match(ioErrorRegex)) {
      this.$emitUpdate(this, { error: 'stream error' })
      this.stop()
    }
  }

  stop() {
    if (this.ready) {
      this.$emitUpdate(this, { ready: false })
      console.log('ffmpeg stop')
      try {
        this.process.stdin.write('q\r\n')
        setTimeout(() => {
          this.process.kill('SIGKILL')
        }, 200)
      } catch (err) {
        console.log('stop err?', err)
      }
    }
  }
}
