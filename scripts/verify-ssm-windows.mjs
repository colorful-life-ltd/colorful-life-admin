// Native Windows process ownership, no AWS calls, credentials or Backend access.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {spawnOwnedTunnel} from '../dist-electron/ssm-process.js'
assert.equal(process.platform,'win32','This test requires actual Windows Job Objects')
const folder=await mkdtemp(join(tmpdir(),'admin-owned-ssm-'))
const alive=pid=>{try{process.kill(pid,0);return true}catch{return false}}
async function until(test){for(let i=0;i<100;i++){if(await test())return;await new Promise(r=>setTimeout(r,100))}throw Error('Owned process did not reach expected state')}
const fake=join(folder,'fake-cli.mjs')
await writeFile(fake,`import {spawn} from 'node:child_process';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});console.log('ROOT='+process.pid+' CHILD='+child.pid);if(process.argv.includes('exit'))setTimeout(()=>process.exit(0),1500);setInterval(()=>{},1000);`)
const unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'})
try{
 for(const exitEarly of [false,true]){
  const tunnel=await spawnOwnedTunnel(process.execPath,[fake,...(exitEarly?['exit']:[])],process.env)
  let root,child,exited=false
  tunnel.onOutput(text=>{const m=text.match(/ROOT=(\d+) CHILD=(\d+)/);if(m){root=Number(m[1]);child=Number(m[2])}})
  tunnel.onExit(()=>{exited=true})
  await until(()=>root&&child&&alive(root)&&alive(child))
  if(exitEarly)await until(()=>exited)
  await tunnel.stop();await tunnel.stop()
  await until(()=>!alive(root)&&!alive(child));assert.ok(alive(unrelated.pid))
  console.log(exitEarly?'Unexpected CLI exit: owned plugin cleaned; unrelated process preserved':'Normal shutdown: owned CLI/plugin cleaned; unrelated process preserved')
 }
 // Abrupt Electron-equivalent death closes the supervisor pipe and Job handle.
 const host=join(folder,'fake-electron.mjs')
 await writeFile(host,`import {spawnOwnedTunnel} from ${JSON.stringify(pathToFileURL(join(process.cwd(),'dist-electron','ssm-process.js')).href)};const t=await spawnOwnedTunnel(process.execPath,[${JSON.stringify(fake)}],process.env);t.onOutput(text=>process.stdout.write(text));setInterval(()=>{},1000);`)
 const electron=spawn(process.execPath,[host],{windowsHide:true,stdio:['ignore','pipe','pipe']})
 let root,child,text=''
 electron.stdout.on('data',data=>{text+=data;const m=text.match(/ROOT=(\d+) CHILD=(\d+)/);if(m){root=Number(m[1]);child=Number(m[2])}})
 electron.stderr.on('data',()=>undefined)
 try{
  await until(()=>root&&child&&alive(root)&&alive(child));electron.kill()
  await until(()=>!alive(root)&&!alive(child));assert.ok(alive(unrelated.pid))
  console.log('Abrupt application exit: job containment cleaned owned descendants')
 }finally{electron.kill()}
}finally{unrelated.kill();await rm(folder,{recursive:true,force:true})}
