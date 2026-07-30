import { cp,mkdir,readFile,rm,writeFile } from 'node:fs/promises'
import { dirname,join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root=join(dirname(fileURLToPath(import.meta.url)),'..')
const source=join(root,'services','functions','deploy-dist','index.js')
const target=join(root,'.artifacts','functions')
await rm(target,{recursive:true,force:true})
await mkdir(target,{recursive:true})
const bundled=await readFile(source,'utf8')
if (/@zamam\//.test(bundled)||/from ['"]zod['"]/.test(bundled)) throw new Error('FUNCTION_ARTIFACT_HAS_WORKSPACE_RUNTIME_DEPENDENCY')
await cp(source,join(target,'index.js'))
await writeFile(join(target,'package.json'),JSON.stringify({
  name:'zamam-functions-artifact',private:true,version:'0.1.0',type:'module',main:'index.js',
  engines:{node:'22'},dependencies:{'firebase-admin':'14.2.0','firebase-functions':'7.3.2'},
},null,2)+'\n')
await writeFile(join(target,'ARTIFACT_MANIFEST.json'),JSON.stringify({
  formatVersion:1,generatedFrom:'services/functions/src/index.ts',
  workspaceDependenciesBundled:true,externalDependencies:['firebase-admin','firebase-functions'],
},null,2)+'\n')
console.log(`Prepared local Functions artifact: ${target}`)
