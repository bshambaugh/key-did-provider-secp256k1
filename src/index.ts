import { createJWS, EllipticSigner } from 'did-jwt'
import {
  HandlerMethods,
  RequestHandler,
  RPCConnection,
  RPCError,
  RPCRequest,
  RPCResponse,
  createHandler,
} from 'rpc-utils'
import stringify from 'fast-json-stable-stringify'
import * as u8a from 'uint8arrays'
import { ec as EC } from 'elliptic'
import multicodec from 'multicodec' 

const ec = new EC('secp256k1')

console.log(multicodec)

function toStableObject(obj: Record<string, any>): Record<string, any> {
  return JSON.parse(stringify(obj)) as Record<string, any>
}

export function encodeDID(secretKey: Uint8Array): string {
  const pubBytes = ec.keyFromPrivate(secretKey).getPublic(true, 'array')
  const bytes = new Uint8Array(pubBytes.length + 2)
  bytes[0] = 0xe7 // secp256k1 multicodec
  // The multicodec is encoded as a varint so we need to add this.
  // See js-multicodec for a general implementation
  bytes[1] = 0x01
  bytes.set(pubBytes, 2)
  return `did:key:z${u8a.toString(bytes, 'base58btc')}`
}

interface Context {
  did: string
  secretKey: Uint8Array
}

interface CreateJWSParams {
  payload: Record<string, any>
  protected?: Record<string, any>
  did: string
}

interface AuthParams {
  paths: Array<string>
}

const didMethods: HandlerMethods<Context> = {
  did_authenticate: ({ did }, params: AuthParams) => {
    return { did, paths: params.paths }
  },
  did_createJWS: async ({ did, secretKey }, params: CreateJWSParams) => {
    const requestDid = params.did.split('#')[0]
    if (requestDid !== did) throw new RPCError(4100, `Unknown DID: ${did}`)
    const pubkey = did.split(':')[2]
    const kid = `${did}#${pubkey}`
    const signer = EllipticSigner(u8a.toString(secretKey, 'base16'))
    const header = toStableObject(Object.assign(params.protected || {}, { kid }))
    const jws = await createJWS(toStableObject(params.payload), signer, header)
    return { jws }
  },
  did_decryptJWE: () => {
    throw new RPCError(4100, 'Decryption not supported')
  },
}

export class Secp256k1Provider implements RPCConnection {
  protected _handle: (msg: RPCRequest) => Promise<RPCResponse | null>

  constructor(secretKey: Uint8Array) {
    const did = encodeDID(secretKey)
    const handler: RequestHandler = createHandler<Context>(didMethods)
    this._handle = (msg: RPCRequest) => {
      return handler({ did, secretKey }, msg)
    }
  }

  public get isDidProvider(): boolean {
    return true
  }

  public async send(msg: RPCRequest): Promise<RPCResponse | null> {
    return await this._handle(msg)
  }
}
