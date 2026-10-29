import {copyFileSync,mkdirSync} from 'node:fs'
mkdirSync('dist-electron',{recursive:true})
copyFileSync('electron/ssm-job.ps1','dist-electron/ssm-job.ps1')
