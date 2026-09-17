import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run=promisify(execFile); const validator='tools/validate-measurement-manifest.mjs'; const template=JSON.parse(await readFile('deployment/v1/measurement-manifest.template.json','utf8'));
async function check(data,mode='--template',expected=true){const d=await mkdtemp(join(tmpdir(),'bsa-infra-'));const f=join(d,'manifest.json');await writeFile(f,JSON.stringify(data));try{const ok=await run('node',[validator,mode,`--manifest=${f}`]).then(()=>true).catch(()=>false);assert.equal(ok,expected);}finally{await rm(d,{recursive:true,force:true});}}
const clone=()=>JSON.parse(JSON.stringify(template));
test('template happy path',()=>check(clone()));
for(const [name,mutate] of [['region',x=>x.region='literal'],['network',x=>x.networkProfiles['4G'].downMbps=8],['private worker',x=>x.services[2].privateWorker=false],['digest',x=>x.services[0].digest='sha256:bad'],['secret',x=>x.database.url='postgresql://secret'],['sandbox',x=>x.prerequisites.razorpaySandbox='passed'],['observability',x=>x.observability.redacted=false],['rollback',x=>x.rollback.killSwitch='delete-all'],['harness pin',x=>x.harness.obs=''],['seed engine',x=>x.database.engine='mysql'],['service set',x=>x.services.pop()],['docker source',x=>x.services[0].source='other/repo']])test(`rejects ${name}`,()=>{const x=clone();mutate(x);return check(x,'--template',false);});
function local(){const x=clone();x.deploymentState='local-executable';x.project='local-project';x.domain='local-loopback';x.region='local-region';x.database.url='postgres://postgres:test@127.0.0.1:55441/postgres';x.database.directListener=x.database.url;x.database.maxRows=100;x.database.indexes='local-schema-smoke';x.capacity={maxInstances:1,concurrency:10,budget:'local'};x.services.forEach(s=>s.digest='sha256:'+'0'.repeat(64));x.harness={obs:'local',chromium:'local',android:'local',ios:'local'};return x;}
test('local executable happy path',()=>check(local(),'--local-executable'));
test('local executable rejects production identity',()=>{const x=local();x.project='prod-project';return check(x,'--local-executable',false);});
