import WideEvent from './WideEvent.js'

const CodecList = ['avc1.420034', 'avc1.4d0034', 'avc1.640034']

// const MEDIA_HEAD_LENGTH = 26
const FRAME_HEAD_LENGTH = 10

const DefaultOpts = {
  audioNumberOfChannels: 2,
  audioCodec: 'opus',
  audioSampleRate: 48000,
  videoCodec: 'avc1.640034',
  audioBitrate: 0.1e6,
  videoBitrate: 2e6,
  framerate: 60,
  width: 0,
  height: 0
}

class NoMuxPacker extends WideEvent {
  constructor (opts = {}) {
    super()
    const def = { maxSize: 120000, maxTime: 80 }
    this.opts = Object.assign(def, DefaultOpts, opts)
    this.buff = new ArrayBuffer(this.opts.maxSize * 2)
    this.array = new Uint8Array(this.buff)
    this.dv = new DataView(this.buff)
    this.chunkIndex = []
    this.timer = false
    this.pointer = 0
    this.packetIndex = 0
  }

  setOpts (opts) {
    // console.log('packer set opts', opts)
    this.flush()
    Object.assign(this.opts, opts)
  }

  write8 (val) {
    this.dv.setUint8(this.pointer, val)
    this.pointer += 1
  }

  write16 (val) {
    this.dv.setUint16(this.pointer, val)
    this.pointer += 2
  }

  write32 (val) {
    this.dv.setUint32(this.pointer, val)
    this.pointer += 4
  }

  writeChunk (encodedData) {
    encodedData.copyTo(this.array.subarray(this.pointer))
    this.pointer += encodedData.byteLength
  }

  writeMediaInfo () {
    this.write8(0) // will be set to chunk count
    const o = this.opts
    this.write8(CodecList.indexOf(o.videoCodec)) // video codec
    this.write16(o.width) // video width
    this.write16(o.height) // video height
    this.write8(o.framerate) // target video framerate
    this.write8(o.audioNumberOfChannels) // audio channels
    this.write32(o.audioSampleRate) // audio sample rate
    this.write16(o.videoBitrate / 1000) // target video mbit rate
    this.write16(o.audioBitrate / 1000) // target audio mbit rate
    this.timer = setTimeout(this.flush.bind(this), this.opts.maxTime)
  }

  initPacket (type) {
    this.reset()
    this.write32(this.packetIndex) // packet index
    this.write8(1) // protocol version
    this.write8(type) // content: 0: stop, 1: json, 2: media
    this.write32(0) // will be set to packet size
    this.writeMediaInfo()
  }

  reset () {
    this.pointer = 0
    clearTimeout(this.timer)
    this.timer = false
    this.chunkIndex.length = 0
  }

  flush () {
    const count = this.chunkIndex.length
    if (count) {
      this.chunkIndex.forEach(idx => this.write32(idx))
      this.dv.setUint32(6, this.pointer)
      this.dv.setUint8(10, count)
      this.send()
    }
    this.reset()
  }

  feed (encodedData, timestamp) {
    const size = encodedData.byteLength
    const count = this.chunkIndex.length
    const isVideo = encodedData instanceof self.EncodedVideoChunk
    const overSize = (this.pointer + size + 24) + ((count + 1) * 4) > this.opts.maxSize
    const notStarted = !this.timer
    const overCount = count > 254
    // console.log(isVideo ? 'video' : 'audio', size, overSize, notStarted, overCount)
    if (overSize || overCount || notStarted) {
      this.flush()
      this.initPacket(2)
    }
    this.chunkIndex.push(this.pointer)
    this.write8(isVideo ? 1 : 0)
    this.write8(encodedData.type === 'key' ? 1 : 0)
    this.write32(Math.floor(timestamp / 1000))
    this.write32(encodedData.duration)
    this.writeChunk(encodedData)
  }

  send () {
    this.$emit('packet', this.buff.slice(0, this.pointer))
    this.packetIndex += 1
  }

  stop () {
    this.flush()
    this.initPacket(0)
    this.send()
  }
}

class NoMuxUnpacker extends WideEvent {
  constructor () {
    super()
    this.opts = Object.assign({}, DefaultOpts)
    this.buff = false
    this.dv = false
    this.pointer = 0
    this.packetIndex = 0
  }

  read8 () {
    const val = this.dv.getUint8(this.pointer)
    this.pointer += 1
    return val
  }

  read16 () {
    const val = this.dv.getUint16(this.pointer)
    this.pointer += 2
    return val
  }

  read32 () {
    const val = this.dv.getUint32(this.pointer)
    this.pointer += 4
    return val
  }

  readChunk (length) {
    const sub = new Uint8Array(this.buff.slice(this.pointer, this.pointer + length))
    this.pointer += length
    return sub
  }

  feed (packet) {
    this.buff = packet
    this.dv = new DataView(packet)
    this.pointer = 0
    this.packetIndex += 1
    const indexes = []
    this.$emit('index', this.read32()) // the first int is packet index
    const version = this.read8()
    const packetType = this.read8()
    if (version !== 1) {
      this.$emit('error', 'wrong packet format')
      return
    }
    if (packetType === 0) {
      this.$emit('stop')
    }
    const txSize = this.read32()
    const size = packet.byteLength
    if (txSize !== size) {
      this.$emit('error', 'mismatch length')
      return
    }
    const count = this.read8()
    const endLength = count * 4
    const opts = {
      videoCodec: CodecList[this.read8()],
      width: this.read16(),
      height: this.read16(),
      framerate: this.read8(),
      audioChannels: this.read8(),
      audioSampleRate: this.read32(),
      videoBitrate: this.read16(),
      audioBitrate: this.read16()
    }
    // console.log(count)
    this.$emitUpdate(this.opts, opts, 'update')
    const savePointer = this.pointer
    this.pointer = size - endLength
    for (let i = 0; i < count; i++) {
      indexes.push(this.read32())
    }
    this.pointer = savePointer
    for (let i = 0; i < count; i++) {
      const idx = indexes[i]
      const isLast = i === count - 1
      const length = (isLast ? (size - endLength) - idx : indexes[i + 1] - idx) - FRAME_HEAD_LENGTH
      const medium = this.read8() === 1 ? 'video' : 'audio'
      const isKey = this.read8() === 1
      const timestamp = this.read32() * 1000
      const duration = this.read32() * 1000
      const data = this.readChunk(length)
      if (data.length) {
        this.$emit('chunk', {
          timestamp,
          duration,
          medium,
          type: isKey ? 'key' : 'delta',
          data
        })
      }
    }
  }
}

export { NoMuxPacker, NoMuxUnpacker }