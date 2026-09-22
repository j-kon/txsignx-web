import { capabilitiesSchema, catalogSchema, malformed, preflightSchema, psbtSchema, transactionSchema } from './schema'
import type { Schema } from './schema'
export const MAX_TEXT_BYTES = 1024 * 1024
export const MAX_BODY_BYTES = 2 * MAX_TEXT_BYTES
export const MAX_OUTPUT_BYTES = 8 * MAX_TEXT_BYTES
export type PreflightRequest = {
  psbt: string
  policy?: {max_absolute_fee_sats?: number; max_fee_ratio_bps?: number}
  wallet?: {network:string; external_descriptor:string; internal_descriptor:string; derivation_window?:number; expected_change_outputs?:number[]}
  node?: {use_configured_node:boolean}
}
const messages: Record<string,string> = {
  invalid_psbt:'The supplied PSBT could not be inspected.', invalid_transaction:'The supplied raw transaction could not be inspected.',
  invalid_txid:'The supplied transaction ID is invalid. Enter a 64-character hexadecimal TXID.', invalid_network:'The selected Bitcoin network is invalid or unsupported.',
  invalid_wallet:'Wallet context was rejected. Check public descriptors, network and derivation window.', invalid_policy:'Policy thresholds were rejected.',
  node_unavailable:'The configured node is unavailable. Check the local API configuration.', node_not_configured:'TXID lookup requires a Bitcoin Core node configured on the TxSignX API.',
  invalid_context:'The supplied context is invalid. Check wallet and node settings.', timeout:'Analysis timed out. Reduce the input or try again.', busy:'The API is busy. Try again shortly.',
}
export const textBytes = (text:string) => new TextEncoder().encode(text).byteLength
export function validateText(text:string) {
  if (!text.trim()) throw new Error('Paste a transaction or choose a sample first.')
  if (textBytes(text)>MAX_TEXT_BYTES) throw new Error('Input exceeds the 1 MiB text limit.')
}
function safeNumbers(value:unknown, depth=0):void {
  if (depth>100) throw malformed()
  if (typeof value==='number' && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) throw malformed()
  if (value && typeof value==='object') for (const child of Object.values(value)) safeNumbers(child,depth+1)
}
async function readBounded(response:Response) {
  if (Number(response.headers.get('content-length'))>MAX_OUTPUT_BYTES) throw new Error('The API response is too large.')
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json') || !response.body) throw malformed()
  const reader=response.body.getReader(); const chunks:Uint8Array[]=[]; let length=0
  try {
    while (true) {
      const {done,value}=await reader.read(); if (done) break
      length+=value.byteLength
      if (length>MAX_OUTPUT_BYTES) { await reader.cancel(); throw new Error('The API response is too large.') }
      chunks.push(value)
    }
  } finally {reader.releaseLock()}
  const bytes=new Uint8Array(length); let offset=0
  for (const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.length}
  let parsed:unknown
  try {parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))} catch {throw malformed()}
  safeNumbers(parsed); return parsed
}
export class ApiClient {
  readonly baseUrl:string
  private readonly timeoutMs:number
  constructor(url=import.meta.env.VITE_TXSIGNX_API_URL || 'http://127.0.0.1:8080', timeoutMs=35000) {
    this.timeoutMs=timeoutMs
    let parsed:URL
    try {parsed=new URL(url)} catch {throw new Error('Invalid API URL configuration.')}
    if (!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.search||parsed.hash) throw new Error('Invalid API URL configuration.')
    this.baseUrl=parsed.href.replace(/\/$/,'')
  }
  private async request<T>(path:string,schema:Schema<T>,body?:unknown):Promise<T> {
    const serialized=body===undefined?undefined:JSON.stringify(body)
    if (serialized && textBytes(serialized)>MAX_BODY_BYTES) throw new Error('Request exceeds the 2 MiB body limit.')
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),this.timeoutMs)
    try {
      let response:Response
      try {response=await fetch(`${this.baseUrl}/api/v1/${path}`,{method:body===undefined?'GET':'POST',headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},body:serialized,signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'})}
      catch {throw new Error(controller.signal.aborted?'Analysis timed out. Try again.':'Could not reach the TxSignX API. Check that it is running and the allowed origin is configured.')}
      const data=await readBounded(response)
      if (!response.ok) {
        const code=(data as {error?:{code?:unknown}})?.error?.code
        throw new Error(typeof code==='string' && messages[code] || (response.status===413?'Input exceeds an API size limit.':response.status===503?'The API or configured node is unavailable. Try again.':'The API rejected the request. Check your input and context.'))
      }
      return schema(data)
    } catch(error) {
      if (controller.signal.aborted) throw new Error('Analysis timed out. Try again.')
      throw error
    } finally {clearTimeout(timer)}
  }
  capabilities() {return this.request('capabilities',capabilitiesSchema)}
  policies() {return this.request('policies',catalogSchema)}
  async inspectTransaction(raw_transaction:string, network?:string) {
    validateText(raw_transaction)
    const body: {raw_transaction:string; network?:string} = {raw_transaction}
    if (network) body.network = network
    return this.request('transactions/inspect',transactionSchema,body)
  }
  async inspectTxid(txid:string) {
    validateText(txid)
    return this.request('transactions/inspect',transactionSchema,{txid:txid.trim()})
  }
  async inspectPsbt(psbt:string) {validateText(psbt);return this.request('psbt/inspect',psbtSchema,{psbt})}
  async preflight(request:PreflightRequest) {validateText(request.psbt);return this.request('psbt/preflight',preflightSchema,request)}
}
