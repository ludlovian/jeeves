import test from 'node:test'
import assert from 'node:assert/strict'

import jeeves from '@ludlovian/jeeves'

test('demand', t => {
  test('response handling', t => {
    test('basic http get', async t => {
      const url = 'http://httpbin.org/get'
      const resp = await jeeves.get(url)
      const act = await resp.json()
      assert.equal(act.url, url)
    })

    test('basic https get', async t => {
      const url = 'https://httpbin.org/get'
      const resp = await jeeves.get(url)
      const act = await resp.json()
      assert.equal(act.url, url)
    })

    test('http with bad status code', async t => {
      const url = 'http://httpbin.org/status/404'
      await assert.rejects(() => jeeves.get(url), {
        statusCode: 404,
        url
      })
    })

    test('http with redirect', async t => {
      const url1 = new URL('http://httpbin.org/redirect-to')
      const url2 = 'http://httpbin.org/get'
      url1.search = new URLSearchParams({ url: url2 })
      const resp = await jeeves.get(url1)
      const act = await resp.json()
      assert.equal(act.url, url2)
    })

    test('http with redirect but not following', async t => {
      const url1 = new URL('http://httpbin.org/redirect-to')
      const url2 = 'http://httpbin.org/get'
      url1.search = new URLSearchParams({ url: url2 })
      const resp = await jeeves.get(url1, { redirect: false })
      resp.resume()
      assert.equal(resp.statusCode, 302)
    })
  })
})
