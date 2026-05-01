import { request as _request } from 'node:https'
import { globalAgent } from 'node:http'

function demand (
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

    const req = _request(url, opts, res => {
      res.text = text
      res.json = json
      if (res.statusCode >= 400) {
        reject(makeError(res, url))
      } else if (res.statusCode >= 300 && redirect && res.headers.location) {
        url = new URL(res.headers.location, url)
        demand(method, url, { body, ...opts }).then(resolve, reject)
      } else {
        resolve(res)
      }
    })

    req.on('error', reject)

    if (body) {
      if (typeof body === 'object' && !Buffer.isBuffer(body)) {
        body = JSON.stringify(body)
        req.setHeader('Content-Type', 'application/json')
      }
      req.setHeader('Content-Length', Buffer.byteLength(body))
      req.write(body)
    }
    req.end()
  })
}

function makeError (res, url) {
  const err = new Error(res.statusMessage)
  err.statusCode = res.statusCode
  err.headers = res.headers
  err.url = url + ''
  return err
}

async function text () {
  let data = ''
  this.setEncoding('utf8')
  for await (const chunk of this) {
    data += chunk
  }
  return data
}

async function json (reviver) {
  const text = await this.text()
  return JSON.parse(text, reviver)
}

const get = demand.bind(null, 'GET')
const post = demand.bind(null, 'POST')
export { demand, get, post }
