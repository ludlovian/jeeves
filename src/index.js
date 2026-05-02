import assert from 'node:assert'
import { request as _request } from 'node:https'
import { createGunzip } from 'node:zlib'
import { globalAgent } from 'node:http'
import { Readable } from 'node:stream'
import Debug from '@ludlovian/debug'

const debug = Debug('jeeves:main')

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
        } else if (res.statusCode >= 300 && redirect && res.headers.location) {
          url = new URL(res.headers.location, url)
          this.demand(method, url, { body, ...opts }).then(resolve, reject)
        } else {
          resolve(new Jeeves(res))
        }
      })

      req.on('error', reject)

      this.#sendBody(req, body)
    })
  }

  static #sendBody (req, body) {
    if (!body) return req.end()

    if (typeof body !== 'object') {
      assert(typeof body === 'string', 'Invalid type of body')
      body = Buffer.from(body)
    }

    let ct

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

    if (ct && !req.hasHeader('content-type')) {
      req.setHeader('content-type', ct)
    }

    if (!req.hasHeader('content-length')) {
      req.setHeader('content-length', body.length)
    }
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
      debug('unzipping stream')
      const gunzip = createGunzip()
      gunzip.on('error', e => this.#res.emit('error', e))
      return this.#res.pipe(gunzip)
    }
    return this.#res
  }

  async text () {
    const str = this.stream()
    str.setEncoding('utf8')
    let data = ''
    for await (const chunk of str) {
      data += chunk
    }
    return data
  }

  async json (reviver) {
    return JSON.parse(await this.text(), reviver)
  }

  async blob () {
    const buffers = []
    for await (const chunk of this.stream()) {
      buffers.push(chunk)
    }
    return Buffer.concat(buffers)
  }

  [Symbol.asyncIterator] () {
    return this.stream()[Symbol.asyncIterator]()
  }
}

const get = Jeeves.demand.bind(Jeeves, 'GET')
const post = Jeeves.demand.bind(Jeeves, 'POST')
const demand = Jeeves.demand.bind(Jeeves)

export { demand, get, post }
export default { demand, get, post }
