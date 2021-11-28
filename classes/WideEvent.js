const eSym = Symbol('evt')

// const getClass = (obj) => {
//   return Object.prototype.toString.call(obj).match(/^\[object\s(.*)\]$/)[1]
// }

module.exports = class WideEvent {
  constructor(echo = false) {
    this[eSym] = {}
    this.echo = echo
  }

  $on(evt, cb) {
    const $on = (e) => {
      this[eSym][e] ? this[eSym][e].push(cb) : this[eSym][e] = [cb]
    }
    cb && (Array.isArray(evt) ? evt.forEach(e => $on(e)) : $on(evt))
  }

  $off(evt, cb) {
    const $off = (e) => {
      const es = this[eSym][e]
      if (es && es.includes(cb)) { es[es.indexOf(cb)] = null }
      es && !cb && delete this[eSym][e]
    }
    if (!evt && !cb) {
      this[eSym] = {}
    } else {
      (Array.isArray(evt) ? evt.forEach(e => $off(e)) : $off(evt))
    }
  }

  $emitUpdate(oldObj, newObj, prefix) {
    let anyUpdate = false
    Object.keys(newObj).forEach((key) => {
      if (oldObj[key] !== newObj[key]) {
        oldObj[key] = newObj[key]
        this.$emit(`${key}`, newObj[key])
        anyUpdate = true
      }
    })
    prefix && anyUpdate && this.$emit(prefix, newObj)
    return anyUpdate
  }

  $emit(evt, data) {
    const e = this[eSym][evt]
    this.echo && console.log(this.constructor.name, evt, data)
    if (e) {
      e.forEach(ev => ev && ev(data))
      // get rid of any blank spaces left from events that deleted callbacks
      this[eSym][evt] = this[eSym][evt].filter(e => e)
    }
  }
}
