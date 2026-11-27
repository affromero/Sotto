"""Observe predecessor rows without exposing the data they contain."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from scripts.deploy.images.metadata import record
from scripts.deploy.review.build_observer import TARGET
from scripts.deploy.review.state import atomic_json, private_json
from scripts.deploy.review.topology import rows

if TYPE_CHECKING:
    from scripts.deploy.review.runtime.operations import HostOperations


PRESERVATION_OBSERVER = r'''
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const {Client}=require('pg');
const raw=fs.readFileSync(0);
assert(raw.length<=262144);
const retained=JSON.parse(raw);
const client=new Client({connectionString:process.env.DATABASE_URL,
 connectionTimeoutMillis:5000,query_timeout:5000});
const timer=setTimeout(()=>process.exit(124),60000);
const quote=name=>{
 assert(typeof name==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(name));
 return '"'+name+'"';
};
async function seedScope(seed){
 if(seed===null)return new Map();
 const {id,target,expected}=seed;
 assert(typeof id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(id));
 assert(typeof target==='string'&&/^[a-z]{2}$/.test(target));
 const scopes=new Map([
  ['Curriculum',{predicate:'t.id=$1',value:id,count:expected?1:0}],
  ['Lesson',{predicate:'t."curriculumId"=$1',value:id,count:expected?.lessons??0}],
  ['LessonLearningObjective',{predicate:'EXISTS (SELECT 1 FROM "Lesson" l WHERE l.id=t."lessonId" AND l."curriculumId"=$1)',
    value:id,count:expected?.mapped??0}],
  ['LearningMapRevision',{predicate:'t."targetLang"=$1',value:target,count:expected?1:0}],
  ['LearningNodeIdentity',{predicate:'t."targetLang"=$1',value:target,count:0}],
 ]);
 if(expected){
  const {rows}=await client.query(
   'SELECT version,"catalogHash",definition FROM "LearningMapRevision" WHERE "targetLang"=$1',
   [target]);
  assert.equal(rows.length,1);
  const [revision]=rows;
  assert.equal(revision.version,expected.catalogRevision.version);
  assert.equal(revision.catalogHash,expected.catalogRevision.hash);
  const nodes=revision.definition.nodes.map(({id,branch,kind})=>({id,branch,kind}));
  assert(nodes.length>0&&nodes.length<=10000);
  const actual=(await client.query(
   'SELECT id,branch,kind FROM "LearningNodeIdentity" WHERE "targetLang"=$1 LIMIT 10001',
   [target])).rows;
  const ordered=items=>items.sort((a,b)=>a.id.localeCompare(b.id));
  assert.deepEqual(ordered(actual),ordered(nodes));
  scopes.get('LearningNodeIdentity').count=nodes.length;
 }
 return scopes;
}
async function assessmentScope(input){
 if(input===null)return null;
 const {binding,namespace,delivery}=input;
 const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
 const digest=/^[a-f0-9]{64}$/;
 assert(uuid.test(binding.id)&&uuid.test(binding.parentId)&&uuid.test(binding.executorId));
 assert(digest.test(binding.fingerprint));
 assert.equal(namespace,'sotto-platform-v2');
 const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
 const prefix=hash(namespace);
 const key=(kind,id)=>'sd-'+kind+':1:'+prefix+':'+id;
 const executionKey=key('je',binding.id), jobKey=key('j',binding.parentId);
 const gateKey=key('jeg',binding.parentId);
 const receiptKey=namespace+':assessment-cleanup:'+binding.id;
 const execution=(await client.query(
  'SELECT state FROM "SidedoorState" WHERE id=$1',[executionKey])).rows[0]?.state;
 assert(execution&&execution.kind==='job_execution');
 for(const field of ['id','parentId','executorId','fingerprint'])
  assert.equal(execution[field],binding[field]);
 const settled=execution.status==='settled';
 assert(settled?!Object.hasOwn(execution,'workspace'):
  execution.status==='cleanup-unconfirmed'&&execution.workspace?.executionId===binding.id);
 assert(Array.isArray(execution.scopeDigests)&&execution.scopeDigests.length>0&&
  execution.scopeDigests.length<=100&&execution.scopeDigests.every(x=>digest.test(x)));
 const scopeKeys=execution.scopeDigests.map(scope=>key('jes',scope+':'+binding.id));
 assert.equal(new Set(scopeKeys).size,scopeKeys.length);
 const pendingKey=key('jp',binding.parentId),incompleteKey=key('ji',binding.parentId);
 const keys=[executionKey,jobKey,gateKey,receiptKey,pendingKey,incompleteKey,...scopeKeys];
 const selected=(await client.query(
  'SELECT id,revision,state FROM "SidedoorState" WHERE id=ANY($1) ORDER BY id',[keys])).rows;
 const indexed=new Map(selected.map(row=>[row.id,row]));
 assert.equal(indexed.size,selected.length);
 const executionRow=indexed.get(executionKey),job=indexed.get(jobKey),gate=indexed.get(gateKey);
 assert.deepEqual(executionRow.state,execution);
 assert(job?.state.kind==='outbox_job'&&job.state.job.id===binding.parentId&&
  job.state.job.namespace===namespace&&job.state.job.handler==='interactions'&&
  job.state.job.version===6&&job.state.delivered===true&&job.state.complete===settled);
 assert.equal(job.state.fingerprint,binding.fingerprint);
 assert.deepEqual(gate?.state,{id:binding.id,fingerprint:binding.fingerprint,settled});
 const receipt=indexed.get(receiptKey);
 if(receipt){
  assert.deepEqual(receipt.state.binding,binding);
  assert.deepEqual(receipt.state.delivery,delivery);
  assert.equal(receipt.state.workspace.executionId,binding.id);
  if(!settled)assert.deepEqual(receipt.state.workspace,execution.workspace);
 }
 if(settled){
  assert(receipt&&[pendingKey,incompleteKey,...scopeKeys].every(id=>!indexed.has(id)));
 }else{
  assert(!indexed.has(pendingKey));
  assert.deepEqual(indexed.get(incompleteKey)?.state,{
   kind:'outbox_pending',namespace,id:binding.parentId,fingerprint:binding.fingerprint,
  });
  for(const id of scopeKeys)assert.deepEqual(indexed.get(id)?.state,binding);
 }
 const {status,workspace,...retainedExecution}=execution;
 const {complete,...retainedJob}=job.state;
 return { keys, observation: {
  settled, receipt: Boolean(receipt), binding,
  indexesSha256: settled?null:hash(JSON.stringify([incompleteKey,...scopeKeys].map(id=>indexed.get(id)))),
  workspaceSha256: hash(JSON.stringify(workspace??receipt.state.workspace)),
  shapeSha256: hash(JSON.stringify({keys,retainedExecution,retainedJob})),
 }};
}
(async()=>{
 await client.connect();
 try{
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY');
  await client.query("SET LOCAL statement_timeout='5000ms'");
  const setting=await client.query('SHOW transaction_read_only');
  assert.equal(setting.rows[0].transaction_read_only,'on');
  const options=retained!==null&&!Array.isArray(retained)?retained:null;
  const seed=options?.seed??null;
  const recovery=await assessmentScope(options?.assessmentRecovery??null);
  const scoped=await seedScope(seed);
  let inventory;
  if(retained===null){
   const result=await client.query(`SELECT table_name,column_name
    FROM information_schema.columns WHERE table_schema=current_schema()
    AND table_name<>'_prisma_migrations'
    ORDER BY table_name,ordinal_position`);
   assert(result.rows.length>0&&result.rows.length<=10000);
   const mapping=new Map();
   for(const row of result.rows){
    if(!mapping.has(row.table_name)) mapping.set(row.table_name,[]);
    mapping.get(row.table_name).push(row.column_name);
   }
   inventory=[...mapping].map(([table,columns])=>({table,columns}));
  }else inventory=options===null?retained:options.projection;
  assert(Array.isArray(inventory)&&inventory.length>0&&inventory.length<=256);
  const names=new Set();const tables=[];let totalBytes=0,totalRows=0;
  let outsideRecovery=null;
  for(const item of inventory){
   assert(!names.has(item.table));names.add(item.table);
   assert(Array.isArray(item.columns)&&item.columns.length>0
          &&item.columns.length<=256);
   const selected=item.columns.map(quote).join(',');
   const table=quote(item.table);
   const filter=scoped.get(item.table);
   const values=filter?[filter.value]:[];
   if(filter){
    const {rows}=await client.query(
     'SELECT count(*)::int AS count FROM '+table+' t WHERE '+filter.predicate,values);
    assert.equal(rows[0].count,filter.count);
   }
   const base='(SELECT '+selected+' FROM '+table+' t';
   const from=base+(filter?' WHERE NOT ('+filter.predicate+')':'')+') v';
   const budget=await client.query('SELECT count(*)::int AS count,'+
    'coalesce(sum(octet_length(row_to_json(v)::text)),0)::text AS bytes FROM '
    +from,values);
   const count=budget.rows[0].count,bytes=Number(budget.rows[0].bytes);
   totalRows+=count;totalBytes+=bytes;
   assert(count<=10000&&bytes<=4194304&&totalRows<=50000&&totalBytes<=16777216);
   const result=await client.query(
    'SELECT row_to_json(v)::text AS value FROM '+from
    +' ORDER BY row_to_json(v)::text',values);
   assert.equal(result.rows.length,count);
   const hash=crypto.createHash('sha256');let actualBytes=0;
   for(const row of result.rows){
    const size=Buffer.byteLength(row.value);assert(size<=262144);
    actualBytes+=size;hash.update(row.value);hash.update('\n');
   }
   assert.equal(actualBytes,bytes);
   tables.push({table:item.table,columns:item.columns,count,bytes,
                sha256:hash.digest('hex')});
   if(recovery&&item.table==='SidedoorState'){
    assert.deepEqual([...item.columns].sort(),['id','revision','state']);
    const keySet=new Set(recovery.keys);
    const untouched=result.rows.filter(row=>!keySet.has(JSON.parse(row.value).id));
    const outside=crypto.createHash('sha256');
    for(const row of untouched)outside.update(row.value+'\n');
    outsideRecovery={count:untouched.length,sha256:outside.digest('hex')};
   }
  }
  assert([...scoped.keys()].every(name=>names.has(name)));
  const observation={schemaVersion:1,tables,totalBytes,totalRows};
  assert(!recovery||outsideRecovery);
  const output=JSON.stringify(recovery?
   {observation,assessmentRecovery:{...recovery.observation,outside:outsideRecovery}}:
   observation);
  assert(Buffer.byteLength(output)<=262144);console.log(output);
 }finally{
  await client.query('ROLLBACK');await client.end();clearTimeout(timer);
 }
})().catch(()=>{console.error('Review preservation observation refused');
 process.exitCode=1;clearTimeout(timer);});
'''


def preserve_data(operations: HostOperations) -> dict[str, object]:
    path = operations.attempt.directory / 'original-data.json'
    retained = private_json(path) if path.exists() else None
    selected = None if retained is None else [
        {'table': item['table'], 'columns': item['columns']}
        for item in rows(retained['tables'], 'original table')
    ]
    topology = record(operations.manifest['topology'], 'topology')
    web = record(record(topology['services'], 'services')['web'], 'old web')
    actual = record(json.loads(operations.image_command(
        {'reference': web['imageId'], 'sha': TARGET},
        'node', ['-e', PRESERVATION_OBSERVER],
        content=json.dumps(selected).encode(),
    )), 'protected data observation')
    if retained is not None and actual != retained:
        raise ValueError('original-review-data-changed')
    if retained is None:
        atomic_json(path, actual)
    return actual
