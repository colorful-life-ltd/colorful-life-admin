import { mkdtemp, cp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { packager } from '@electron/packager'
const require=createRequire(import.meta.url)
const stage=await mkdtemp(join(tmpdir(),'colorful-life-admin-package-'))
try {
  // Only built assets enter the package: never copy source, .env, local journals,
  // test fixtures, repository metadata or a developer's node_modules.
  await cp(resolve('dist'),join(stage,'dist'),{recursive:true})
  await cp(resolve('dist-electron'),join(stage,'dist-electron'),{recursive:true,filter:source=>!source.endsWith('.map')})
  await writeFile(join(stage,'package.json'),JSON.stringify({name:'colorful-life-admin',productName:'Colorful Life Admin',version:'0.1.0',type:'module',main:'dist-electron/main.js'}))
  const bundles=await packager({dir:stage,out:resolve('release'),name:'Colorful Life Admin',appBundleId:'uk.colorfullife.admin',electronVersion:require('electron/package.json').version,platform:process.platform,arch:process.arch,asar:true,prune:false,overwrite:true})
  console.log('Unsigned validation bundles:',bundles.join(', '))
} finally {await rm(stage,{recursive:true,force:true})}
