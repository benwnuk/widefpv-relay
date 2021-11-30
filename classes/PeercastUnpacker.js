module.exports = class PeercastUnpacker {
  constructor () {
    this.buff = false
    this.dv = false
    this.pointer = 0
    this.packetIndex = 0
    this.onCodec = false
  }

  static codecList = ['avc1.420034', 'avc1.4d0034', 'avc1.640034']

  readByte () {
    const val = this.dv.getUint8(this.pointer)
    this.pointer += 1
    return val
  }

  readInt () {
    const val = this.dv.getUint32(this.pointer)
    this.pointer += 4
    return val
  }

  readChunk (length) {
    const sub = new Uint8Array(this.buff.slice(this.pointer, this.pointer + length))
    this.pointer += length
    // console.log('readChunk', length)
    return sub
  }

  unpack (packet) {
    this.buff = packet
    this.dv = new DataView(packet)
    this.pointer = 0
    this.packetIndex += 1
    const index = this.readInt()
    const txSize = this.readInt()
    const size = packet.byteLength
    if (txSize !== size) {
      console.log('size mismatch', txSize, size)
    }
    const count = this.readByte()
    const endLength = count * 4
    const codec = {
      videoCodec: PeercastUnpacker.codecList[this.readByte()],
      audioChannels: this.readByte(),
      sampleRate: this.readInt(),
      bitrate: 0, // not yet sending
      framerate: 0 // not yet sending
    }
    const indexes = []
    const chunks = []
    const savePointer = this.pointer
    this.pointer = size - endLength
    for (let i = 0; i < count; i++) {
      indexes.push(this.readInt())
    }
    this.pointer = savePointer
    for (let i = 0; i < count; i++) {
      const idx = indexes[i]
      const isLast = i === count - 1
      const length = (isLast ? (size - endLength) - idx : indexes[i + 1] - idx) - 10
      const isVideo = this.readByte() === 1
      const isKey = this.readByte() === 1
      const timestamp = this.readInt() * 1000
      const duration = this.readInt()
      const data = this.readChunk(length)

      if (data.length) {
        chunks.push({
          timestamp,
          duration,
          medium: isVideo ? 'video' : 'audio',
          type: isKey ? 'key' : 'delta',
          data
        })
      }
    }
    return {
      index, codec, chunks
    }
  }
}
