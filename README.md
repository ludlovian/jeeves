# jeeves

_"Fetch that for me, Jeeves"_

An all-purpose fetcher.

Less automagic than `window.fetch`, but slightly easier to use than `node:https`.

## API

### demand (method, url[, options]) => _Promise\<Jeeves\>_

```js
import * as jeeves from '@ludlovian/jeeves'

const response = await jeeves.demand('GET', url, opts)
```

Starts the fetch process and returns a `Jeeves` instance.

#### Options

The options object is (mostly) passed to `https.request`. But in particular:

Key | Usage
--- | ---
redirect | If truthy, Jeeves will follow a redirection
body | The request body to send - see below for how this is dealt with
headers | Headers to send

#### Body processing

The `body` property can be any of the following

Type | Handling
--- | ---
Buffer or Uint8Array | This is sent as is.
URLSearchParams | This is turned into a string, and the content type set to `application/x-www-form-urlencoded`
Object | This is `JSON.stringify`-ed and the content type set to `application/json`
String | Converted to a buffer.

The content length is also set (unless it has deliberately been set in the `headers`).
As is a default user agent, and acceptable encodings include `gzip` and `br`.

### .get (url[, options]) => _Promise\<Jeeves\>_
### .post (url[, options]) => _Promise\<Jeeves\>_

These are just handy shortcuts for `GET` and `POST` requests.

### Jeeves

The object that `.demand` returns is the response. Any errors in producing a
response will result in a rejection.

#### .headers => _Object_

Returns the headers acutally received (as per the `https` module)

#### .statusCode => _Number_

The response's http status

#### .resume ()

This will consume the body of the response. Called when you don't need the body
or it is expected to be empty

#### .stream () => _Readable_

Gives you access to the response data. After gzip or brotli decompression if
the stream was compressed.

Once you have taken the stream, you cannot take it again.

#### .text () => _Promise\<String\>_

Gathers the stream, decoded into a string

#### .json ( [reviver] ) => _Promise\<JSON\>_

Parses the text using `JSON.parse` and the optional reviver.

#### .blob () => _Promise\<Buffer\>_

Gathers the response body into a single `Buffer`.

