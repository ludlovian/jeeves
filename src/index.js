import assert from 'node:assert'
import { request as _request } from 'node:https'
import { createGunzip, createBrotliDecompress } from 'node:zlib'
import { globalAgent } from 'node:http'
import { Readable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'

import { AbortError } from '@ludlovian/emitter'
import Gate from '@ludlovian/lock/gate'
import Debug from '@ludlovian/debug'

const debug = Debug('jeeves:main')
const TESTCTRL = Symbol.for('@ludlovian.testctrl')

const DFLT_UA =
  'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'

class Jeeves {
  #res
  #consumed = false

  // -----------------------------------------------------------------
  //
  // Static level

  static demand (
    method,
    url,
    {
      redirect = true, //       redirect if necessary
      body, //                  if given will be sent as the body
      ...opts
    } = {}
  ) {
    return new Promise((resolve, reject) => {
      url = new URL(url)
      opts.method ??= method
      if (url.protocol === 'http:') opts.agent ??= globalAgent

      debug('fetch: %s', url)

      const req = _request(url, opts, res => {
        if (res.statusCode >= 400) {
          reject(this.#makeError(res, url))
          res.resume() // consume the body
        } else if (res.statusCode >= 300 && redirect && res.headers.location) {
          url = new URL(res.headers.location, url)
          res.resume() // consume the body
          resolve(this.demand(method, url, { body, ...opts }))
        } else {
          resolve(new Jeeves(res))
        }
      })

      req.on('error', reject)
      if (opts.timeout) {
        req.on('timeout', () => {
          const err = new Error('Socket timed out')
          err.code = 'ETIMEDOUT'
          req.destroy(err)
        })
      }

      this.#sendBody(req, body)
    })
  }

  static #sendBody (req, body) {
    let ct

    addHeader(req, 'accept-encoding', 'gzip, br')
    addHeader(req, 'user-agent', DFLT_UA)

    if (!body) return req.end()

    if (typeof body !== 'object') {
      assert(typeof body === 'string', 'Invalid type of body')
      body = Buffer.from(body)
    }

    if (body instanceof Readable) {
      req.on('error', e => body.emit('error', e))
      body.pipe(req)
      return
    } else if (Buffer.isBuffer(body)) {
      // no transform needed
    } else if (body instanceof URLSearchParams) {
      body = Buffer.from(body.toString())
      ct = 'application/x-www-form-urlencoded'
    } else {
      body = Buffer.from(JSON.stringify(body))
      ct = 'application/json'
    }

    addHeader(req, 'content-type', ct)
    addHeader(req, 'content-length', body.length)

    req.write(body)
    req.end()
  }

  static #makeError (res, url) {
    const err = new Error(res.statusMessage)
    err.statusCode = res.statusCode
    err.headers = res.headers
    err.url = url + ''
    return err
  }

  // -----------------------------------------------------------------
  //
  // Instance level

  constructor (res) {
    this.#res = res
    setImmediate(() => {
      if (this.#consumed) return //
      console.warn('Uncomsumed call to Jeeves')
      this.resume()
    })
  }

  get headers () {
    return this.#res.headers
  }

  get statusCode () {
    return this.#res.statusCode
  }

  resume () {
    this.#consumed = true
    // send the data into the void
    this.#res.resume()
  }

  stream () {
    assert(!this.#consumed, 'data has already been consumed')
    this.#consumed = true

    if (this.#res.headers['content-encoding'] === 'gzip') {
      //
      debug('gzip stream')
      const gunzip = createGunzip()
      gunzip.on('error', e => this.#res.emit('error', e))
      return this.#res.pipe(gunzip)
      //
    } else if (this.#res.headers['content-encoding'] === 'br') {
      //
      debug('brotli stream')
      const brotli = createBrotliDecompress()
      brotli.on('error', e => this.#res.emit('error', e))
      return this.#res.pipe(brotli)
      //
    }
    return this.#res
  }

  // Provide the stream as async generator of Buffer[] batches as per
  // the new iterable stream API
  //
  async * iter ({ signal } = {}) {
    const src = this.stream()
    if (!src.readable) return //
    if (signal?.aborted) throw new AbortError()

    let batch = []
    let ended = false
    let err = null

    const gate = new Gate().close()

    // handlers for events
    const onData = buff => gate.open() && batch.push(buff)
    const onAbort = () => gate.open()
    const onEnd = () => gate.open() && (ended = true)
    const onError = e => gate.open() && (err = e)

    // wire up the emitters
    src
      .on('data', onData)
      .on('end', onEnd)
      .once('error', onError)
    signal?.on('abort', onAbort)

    // and process...
    try {
      while (true) {
        // execution could park here ...
        if (!gate.isOpen) await gate.untilOpen()
        gate.close()
        if (err) throw err
        if (signal?.aborted) throw new AbortError()
        if (ended) break //
        const data = batch
        batch = []
        // ... or it could park here
        yield data
      }
      if (batch.length) yield batch
    } catch (_err) {
      // if the error didn't come from the source, then kill the source
      if (!err) src.destroy(_err)
      throw _err
    }
  }

  async text (opts) {
    const decoder = new StringDecoder()
    let output = ''

    for await (const batch of this.iter(opts)) {
      for (const buff of batch) {
        output += decoder.write(buff)
      }
    }
    output += decoder.end()
    return output
  }

  async * lines (opts) {
    const decoder = new StringDecoder()
    let remainder = ''
    for await (const batch of this.iter(opts)) {
      let str = remainder
      for (const buff of batch) {
        str += decoder.write(buff)
      }
      const lines = str.split('\n')
      remainder = lines.pop()
      if (lines.length) yield lines
    }
    remainder += decoder.end()
    if (remainder) yield remainder.split('\n')
  }

  async json (reviver) {
    return JSON.parse(await this.text(), reviver)
  }

  async blob (opts) {
    const buffers = []
    for await (const batch of this.iter(opts)) {
      buffers.push(...batch)
    }
    return Buffer.concat(buffers)
  }

  [Symbol.asyncIterator] () {
    return this.stream()[Symbol.asyncIterator]()
  }

  /* c8 ignore start */
  static [TESTCTRL] (cmd, ...args) {
    switch (cmd) {
      case 'createMock': {
        const j = Object.create(Jeeves.prototype)
        j.#res = args[0]
        j.#consumed = false
        return j
      }
      default:
        throw new Error(`Unknown command: ${cmd}`)
    }
  }
  /* c8 ignore stop */
}

// -----------------------------------------------------------------
//
//  Helpers
//

function addHeader (req, key, val) {
  if (val == null || req.hasHeader(key)) return //
  req.setHeader(key, val)
}

// -----------------------------------------------------------------
//
//  Exports
//

const get = Jeeves.demand.bind(Jeeves, 'GET')
const post = Jeeves.demand.bind(Jeeves, 'POST')
const demand = Jeeves.demand.bind(Jeeves)
demand[TESTCTRL] = Jeeves[TESTCTRL]

export { demand, get, post, Jeeves }
export default { demand, get, post }
