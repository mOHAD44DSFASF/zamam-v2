import { readFileSync,readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe,expect,it } from 'vitest'
import { createTenantBackup,validateTenantRestore } from '@zamam/firestore'
const root=process.cwd()
describe('production readiness invariants',()=>{
  it('keeps the V1 direct-write workspace unreachable from the router',()=>{const app=readFileSync(join(root,'apps/web/src/App.tsx'),'utf8');expect(app).not.toContain("import('./pages/EmployeeWorkspace')");expect(app).toContain('<Navigate to="/tasks" replace />')})
  it('requires App Check acquisition in every authenticated feature client',()=>{const featureRoot=join(root,'apps/web/src/features');const clients=readdirSync(featureRoot,{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>join(featureRoot,entry.name,'client.ts')).filter(path=>{try{return readFileSync(path,'utf8').includes('fetch(')}catch{return false}});expect(clients.length).toBeGreaterThan(15);for(const path of clients)expect(readFileSync(path,'utf8'),path).toContain('appCheckHeaders')})
  it('defines deny-default Firestore rules, composite indexes and hosting headers',()=>{expect(readFileSync(join(root,'firestore.rules'),'utf8')).toContain('allow read, write: if false');const indexes=JSON.parse(readFileSync(join(root,'firestore.indexes.json'),'utf8')) as{indexes:unknown[]};expect(indexes.indexes.length).toBeGreaterThanOrEqual(10);const firebase=JSON.parse(readFileSync(join(root,'firebase.json'),'utf8')) as{hosting:{headers:unknown[]};firestore:{indexes:string};functions:{source:string}[]};expect(firebase.hosting.headers.length).toBeGreaterThan(0);expect(firebase.firestore.indexes).toBe('firestore.indexes.json');expect(firebase.functions[0]?.source).toBe('.artifacts/functions')})
  it('has a clean-install CI gate including emulator and deploy-artifact packaging',()=>{const ci=readFileSync(join(root,'.github/workflows/ci.yml'),'utf8');expect(ci).toContain('npm ci --ignore-scripts');expect(ci).toContain('npm run check');expect(ci).toContain('npm run test:emulator');expect(ci).toContain('npm run package:functions')})
  it('blocks Firebase predeploy while runtime composition or accountable launch evidence is missing',()=>{
    const firebase=JSON.parse(readFileSync(join(root,'firebase.json'),'utf8')) as{functions:{predeploy:string[]}[]}
    expect(firebase.functions[0]?.predeploy[0]).toBe('npm run check:launch-readiness')
    const result=spawnSync(process.execPath,['tools/assert-launch-ready.mjs'],{
      cwd:root,encoding:'utf8',
      env:{...process.env,ZAMAM_LAUNCH_AUTHORITY_APPROVED:'false',ZAMAM_STAGING_ASSURANCE_ID:''},
    })
    expect(result.status).toBe(1)
    expect(result.stderr).not.toContain('FEATURE_COMMAND_DISPATCHER_NOT_COMPOSED')
    expect(result.stderr).toContain('WORKER_TRANSPORT_NOT_COMPOSED')
    expect(result.stderr).toContain('LAUNCH_AUTHORITY_NOT_APPROVED')
  })
  it('composes a real feature command dispatcher instead of the disabled default',()=>{
    const adapter=readFileSync(join(root,'services/functions/src/api/firebase-adapter.ts'),'utf8')
    expect(adapter).not.toContain('DisabledFeatureCommandDispatcher')
    expect(adapter).toContain('composeFeatureCommandDispatcher')
  })
  it('rehearses tenant-scoped backup integrity and rejects corruption',()=>{const bundle=createTenantBackup('org-1',[{path:'v2Organizations/org-1/task/task-1',organizationId:'org-1',data:{organizationId:'org-1',title:'Task'}}]);expect(validateTenantRestore(bundle)).toHaveLength(1);expect(()=>validateTenantRestore({...bundle,payload:`${bundle.payload}x`})).toThrow('BACKUP_CHECKSUM_MISMATCH')})
})
