// Validators mirror the Rust serialization contract, never evaluate policy.
export type Schema<T> = (value: unknown) => T
export type Infer<S> = S extends Schema<infer T> ? T : never
export const malformed = () => new Error('The API returned a malformed or unsupported report.')
const fail = (): never => { throw malformed() }
const str: Schema<string> = v => typeof v === 'string' ? v : fail()
const bool: Schema<boolean> = v => typeof v === 'boolean' ? v : fail()
const integer: Schema<number> = v => typeof v === 'number' && Number.isSafeInteger(v) ? v : fail()
const uint: Schema<number> = v => integer(v) >= 0 ? v as number : fail()
const enumeration = <const T extends readonly string[]>(...values: T): Schema<T[number]> => v => typeof v === 'string' && values.includes(v) ? v : fail()
const nullable = <T>(s: Schema<T>): Schema<T | null> => v => v === null ? null : s(v)
const optional = <T>(s: Schema<T>): Schema<T | undefined> => v => v === undefined ? undefined : s(v)
const array = <T>(s: Schema<T>): Schema<T[]> => v => Array.isArray(v) ? v.map(s) : fail()
const object = <T extends Record<string, Schema<unknown>>>(shape: T): Schema<{[K in keyof T]: Infer<T[K]>}> => v => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail()
  const record = v as Record<string, unknown>
  // Return the original report, including future additive fields, only after validation.
  for (const [key, check] of Object.entries(shape)) check(record[key])
  return v as {[K in keyof T]: Infer<T[K]>}
}
const hex: Schema<string> = v => /^[0-9a-f]*$/.test(str(v)) ? v as string : fail()
const txid: Schema<string> = v => /^[0-9a-f]{64}$/.test(str(v)) ? v as string : fail()
const code: Schema<string> = v => /^TG\d{3}$/.test(str(v)) ? v as string : fail()
const script = enumeration('p2pkh', 'p2sh', 'p2wpkh', 'p2wsh', 'p2tr', 'op_return', 'unknown')
const signing = enumeration('unsigned', 'partially_signed', 'finalized', 'mixed')
const severity = enumeration('info', 'low', 'medium', 'high', 'critical')
const outputFields = { index:uint, value_sats:uint, script_pubkey_hex:hex, script_pubkey_size_bytes:uint, script_type:script }
const inputFields = { index:uint, previous_txid:txid, previous_vout:uint, sequence:uint, explicit_rbf:bool }
const metadataFields = { bip32_derivation_count:uint, tap_key_origin_count:uint, redeem_script_present:bool, witness_script_present:bool, proprietary_count:uint, unknown_count:uint }
export const transactionSchema = object({txid, wtxid:txid, version:integer, locktime:uint, input_count:uint, output_count:uint, size_bytes:uint, weight_wu:uint, vsize_vb:uint, has_witness:bool, explicit_rbf:bool, total_output_sats:uint, fee_sats:nullable(uint),
  inputs:array(object({...inputFields,script_sig_hex:hex,script_sig_size_bytes:uint,witness_item_count:uint,witness_items:array(object({index:uint,size_bytes:uint,hex}))})), outputs:array(object(outputFields))})
export const psbtSchema = object({psbt_version:uint,format:str,unsigned_txid:txid,transaction_version:integer,locktime:uint,input_count:uint,output_count:uint,total_output_sats:uint,explicit_rbf:bool,global_xpub_count:uint,proprietary_count:uint,unknown_count:uint,signing_state:signing,
  fee:object({status:enumeration('available','missing_utxo_context','invalid_utxo_context','negative_fee','overflow','other_error'),fee_sats:nullable(uint)}),
  inputs:array(object({...inputFields,...metadataFields,partial_ecdsa_signature_count:uint,tap_key_signature_present:bool,tap_script_signature_count:uint,final_script_sig_present:bool,final_script_witness_present:bool,signing_state:signing,
    sighash_type:nullable(object({value:uint,name:str})),utxo:object({source:enumeration('missing','witness_utxo','non_witness_utxo','both'),status:enumeration('missing','valid','txid_mismatch','vout_out_of_range','witness_non_witness_mismatch'),value_sats:nullable(uint),script_pubkey_hex:nullable(hex),script_pubkey_size_bytes:nullable(uint),script_type:nullable(script)})})),
  outputs:array(object({...outputFields,...metadataFields,tap_internal_key_present:bool,tap_tree_present:bool}))})
const location: Schema<{type:'global'|'input'|'output';index?:number}> = v => {
  const loc = object({type:enumeration('global','input','output'),index:optional(uint)})(v)
  if (loc.type !== 'global' && loc.index === undefined) return fail()
  return loc
}
const ownership = (v: unknown) => {
  const o = object({type:enumeration('external','internal','no_match_within_window','unavailable'),derivation_index:optional(uint),reason:optional(enumeration('missing_prevout_context','invalid_prevout_context'))})(v)
  if ((o.type==='external'||o.type==='internal') && o.derivation_index===undefined || o.type==='unavailable' && o.reason===undefined) return fail()
  return o
}
const wallet = object({configured_network:str,derivation_window:uint,expected_change_outputs:array(uint),inputs:array(object({index:uint,ownership})),outputs:array(object({index:uint,ownership,expected_change:bool}))})
// Context is additionally structurally checked by its rendering component; optional
// node facts are displayed verbatim rather than used to derive security decisions.
const node = object({configured_network:str,node_network:str,tip:object({height:uint,block_hash:txid}),inputs:array(object({index:uint,outpoint:str,availability:enumeration('confirmed_unspent','mempool_unconfirmed','spent_in_mempool','not_available'),confirmations:nullable(uint),coinbase:nullable(bool),prevout_verification:enumeration('match','value_mismatch','script_mismatch','value_and_script_mismatch','unavailable')}))})
export const preflightSchema = object({inspection:psbtSchema,wallet_context:optional(wallet),node_context:optional(node),policy:object({decision:enumeration('pass','review','block'),risk_level:enumeration('low','medium','high','critical'),highest_severity:nullable(severity),finding_count:uint,findings:array(object({code,severity,title:str,message:str,recommendation:nullable(str),location})),evaluated_rules:array(code),rule_evaluations:array(object({code,status:enumeration('evaluated','partially_evaluated','not_evaluated'),reason:nullable(enumeration('no_wallet_context','no_node_context','no_expected_change_output','no_usable_input_context','some_input_context_unavailable'))})),config:object({max_absolute_fee_sats:uint,max_fee_ratio_bps:uint}),scope_note:str})})
const ruleFields = {code,title:str,description:str,active:bool,required_context:array(str)}
export const catalogSchema = object({active_rules:array(object({...ruleFields,default_severity:severity})),deferred_rules:array(object(ruleFields))})
export const capabilitiesSchema = object({raw_transaction_inspection:bool,psbt_v0_inspection:bool,wallet_context:bool,node_context_available:bool,policy_preflight:bool,broadcast_via_api:bool,signing:bool,finalization:bool,psbt_v2:bool,active_rules:uint,deferred_rules:uint})
export type TransactionReport = Infer<typeof transactionSchema>
export type PsbtReport = Infer<typeof psbtSchema>
export type PreflightReport = Infer<typeof preflightSchema>
export type RuleCatalog = Infer<typeof catalogSchema>
export type Capabilities = Infer<typeof capabilitiesSchema>
export type Report = TransactionReport | PsbtReport | PreflightReport
