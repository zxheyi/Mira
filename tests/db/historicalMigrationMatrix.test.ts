import {expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {openDatabase} from '../../src/db/client.js';
import {migrate,CURRENT_SCHEMA_VERSION} from '../../src/db/schema.js';
const root='tests/fixtures/migrations';
const fixtures=JSON.parse(readFileSync(root+'/manifest.json','utf8')) as Array<{version:number;file:string;fixtureHash:string}>;
function schema(db:ReturnType<typeof openDatabase>) {
 const tables=(db.prepare('pragma table_list').all() as Array<{name:string;type:string}>).filter(row=>row.type!=='shadow'&&!row.name.startsWith('sqlite_')).map(row=>row.name).sort();
 return tables.map(name=>({name,
  triggers:(db.prepare("select name,sql from sqlite_master where type='trigger' and tbl_name=? order by name").all(name) as Array<{name:string;sql:string}>).map(row=>({name:row.name,sql:row.sql.replace(/["`]/g,'').replace(/\s+/g,' ').trim().toLowerCase()})),
  columns:(db.prepare(`pragma table_info('${name}')`).all() as Array<Record<string,unknown>>).map(({cid,...column})=>column).sort((a,b)=>String(a.name).localeCompare(String(b.name))),
  foreignKeys:(db.prepare(`pragma foreign_key_list('${name}')`).all() as Array<Record<string,unknown>>).map(({id,seq,...key})=>key).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),
  indexes:(db.prepare(`pragma index_list('${name}')`).all() as Array<{name:string;unique:number;partial:number}>).map(index=>({unique:index.unique,partial:index.partial,columns:db.prepare(`pragma index_info('${index.name}')`).all()})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))
 }));
}
for(const fixture of fixtures) test(`historical v${fixture.version} upgrades atomically to current with fresh-install parity`,()=>{
 const db=openDatabase(':memory:');const fresh=openDatabase(':memory:');
 try {
  const sql=readFileSync(root+'/'+fixture.file,'utf8');
  expect(createHash('sha256').update(sql).digest('hex')).toBe(fixture.fixtureHash);
  db.exec(sql);
  if(fixture.version<CURRENT_SCHEMA_VERSION) {
   const before=schema(db);const original=db.prepare.bind(db);
   db.prepare=((statement:string)=>{if(statement.startsWith('insert into schema_version'))throw new Error('Injected migration interruption');return original(statement);}) as typeof db.prepare;
   expect(()=>migrate(db)).toThrow(/interruption/);
   db.prepare=original;
   expect(schema(db)).toEqual(before);
   expect(db.prepare('select max(version) from schema_version').pluck().get()).toBe(fixture.version);
   expect(db.pragma('foreign_keys',{simple:true})).toBe(1);
  }
  migrate(db);migrate(db);migrate(fresh);
  expect(db.prepare('select max(version) from schema_version').pluck().get()).toBe(CURRENT_SCHEMA_VERSION);
  expect(db.prepare('select content from memories where id=?').get('memory_fixture')).toEqual({content:'Persisted legacy fact.'});
  expect(db.prepare('pragma foreign_key_check').all()).toEqual([]);
  expect(db.prepare("select id from memory_fts where memory_fts match 'Persisted'").all()).toEqual([{id:'memory_fixture'}]);
  if(fixture.version>=3) {
   expect(db.prepare('select job_id from memory_candidates where id=?').get('candidate_fixture')).toEqual({job_id:'job_fixture'});
   expect(db.prepare('select status from distill_jobs where id=?').get('job_fixture')).toEqual({status:'pending'});
  }
  expect(schema(db)).toEqual(schema(fresh));
 }finally{db.close();fresh.close();}
});
