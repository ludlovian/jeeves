import assert from 'node:assert'
import { request as _request } from 'node:https'
import { createGunzip } from 'node:zlib'
import { globalAgent } from 'node:http'
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

      if (body) {
        if (typeof body === 'object') {
          if (Buffer.isBuffer(body)) {
            // do nothing
          } else if (body instanceof URLSearchParams) {
            body = body.toString()
            req.setHeader('Content-Type', 'application/x-www-form-urlencoded')
          } else {
            body = JSON.stringify(body)
            req.setHeader('Content-Type', 'application/json')
          }
        }
        req.setHeader('Content-Length', Buffer.byteLength(body))
        req.write(body)
      }
      req.end()
    })
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
