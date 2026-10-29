import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const local=await readFile(new URL('../contracts/integration-v1.json',import.meta.url),'utf8')
let canonical
if(process.env.BACKEND_CONTRACT_FILE) canonical=await readFile(process.env.BACKEND_CONTRACT_FILE,'utf8')
else {
 const ref=(await readFile(new URL('../contracts/backend-ref.txt',import.meta.url),'utf8')).trim()
 assert.match(ref,/^[a-f0-9]{40}$/,'Contract source must be an immutable Backend commit')
 const response=await fetch(`https://raw.githubusercontent.com/colorful-life-ltd/colorful-life-backend/${ref}/contracts/integration-v1.json`,{signal:AbortSignal.timeout(20000)})
 assert.ok(response.ok,'Pinned Backend contract could not be fetched')
 canonical=await response.text()
}
assert.equal(local,canonical,'Client contract fixture drifted from its Backend-owned version')
console.log('Client contract matches its immutable Backend source')

// Return Management V1 is owned and versioned by the same immutable Backend source.
const returnLocal=await readFile(new URL('../electron/return-contract.ts',import.meta.url),'utf8')
let returnCanonical
if(process.env.BACKEND_RETURNS_CONTRACT_FILE)returnCanonical=await readFile(process.env.BACKEND_RETURNS_CONTRACT_FILE,'utf8')
else {
 const ref=(await readFile(new URL('../contracts/backend-ref.txt',import.meta.url),'utf8')).trim()
 assert.match(ref,/^[a-f0-9]{40}$/)
 const response=await fetch(`https://raw.githubusercontent.com/colorful-life-ltd/colorful-life-backend/${ref}/src/domain/orders/return-contract.ts`,{signal:AbortSignal.timeout(20000)})
 assert.ok(response.ok,'Pinned Backend return contract could not be fetched')
 returnCanonical=await response.text()
}
assert.equal(returnLocal,returnCanonical,'Return wire contract drifted from its Backend-owned version')
console.log('Return contract matches its immutable Backend source')
