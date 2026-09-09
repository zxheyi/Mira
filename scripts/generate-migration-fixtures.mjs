// Requires Node 24 and full local git history. CI consumes the checked-in SQL fixtures.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import Database from 'better-sqlite3';
const commits={1:'2acc417',2:'dd8d8d0',3:'a7c9db2',4:'5a4b78c',5:'ff4b0c8',6:'e7faace',7:'a1157ee',8:'80dafa4',9:'e6074ff',10:'0ce434e',11:'8057b3f',12:'2f75ca6',13:'2f75ca6',14:'1c5a61b',15:'40f4498',16:'0cc20b3',17:'129f147'};
const out='tests/fixtures/migrations';mkdirSync(out,{recursive:true});
const hash=text=>createHash('sha256').update(text).digest('hex');
const quote=value=>typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'";
const manifest=[];
for(const [versionText,ref] of Object.entries(commits)) {
 const version=Number(versionText);
 const commit=execFileSync('git',['rev-parse',ref],{encoding:'utf8'}).trim();
 const original=execFileSync('git',['show',`${commit}:src/db/schema.ts`],{encoding:'utf8'});
 let source=original;
 if(version===12) source=source.replace('CURRENT_SCHEMA_VERSION = 13','CURRENT_SCHEMA_VERSION = 12').replace(/const requiresV13Setup = [^;]+;/,'const requiresV13Setup = false;');
 const {migrate}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
 const db=new Database(':memory:');db.pragma('foreign_keys = ON');migrate(db);
 if(db.prepare('select max(version) from schema_version').pluck().get()!==version) throw new Error(`Wrong source version ${version}`);
 const shadow=new Set(db.prepare('pragma table_list').all().filter(row=>row.type==='shadow').map(row=>row.name));
 const definitions=db.prepare("select type,name,sql from sqlite_master where sql is not null and name not like 'sqlite_%' order by case type when 'table' then 0 when 'index' then 1 else 2 end,rowid").all().filter(row=>!shadow.has(row.name));
 const seed=[];
 function insert(table,values) {
  const columns=new Set(db.prepare(`pragma table_info(${table})`).all().map(row=>row.name));
  const entries=Object.entries(values).filter(([key])=>columns.has(key));
  seed.push(`insert into ${table} (${entries.map(([key])=>key).join(',')}) values (${entries.map(([,value])=>quote(value)).join(',')});`);
 }
 const at='2026-01-01T00:00:00.000Z';
 insert('schema_version',{version,applied_at:at});
 insert('projects',{id:'project_fixture',name:'Historical fixture',root_path:'/fixture',created_at:at});
 insert('threads',{id:'thread_fixture',project_id:'project_fixture',title:'Original source',source:'codex',raw_format:'markdown',raw_text:'Persisted legacy fact.',created_at:at,updated_at:at});
 insert('memories',{id:'memory_fixture',project_id:'project_fixture',thread_id:'thread_fixture',title:'Legacy fact',kind:'fact',content:'Persisted legacy fact.',source:'manual',confidence:1,content_hash:hash('Persisted legacy fact.'),importance:5,created_at:at,updated_at:at,status:'active'});
 if(version>=3) {
  insert('distill_jobs',{id:'job_fixture',project_id:'project_fixture',thread_id:'thread_fixture',trigger:'cli',channel:'provider',input_hash:'input-fixture',status:'pending',attempts:0,created_at:at,updated_at:at});
  insert('memory_candidates',{id:'candidate_fixture',project_id:'project_fixture',thread_id:'thread_fixture',job_id:'job_fixture',thread_input_hash:'input-fixture',title:'Candidate fixture',kind:'fact',content:'Persisted legacy fact.',confidence:0.8,importance:0.5,source_agent:'codex',extraction_method:'agent',evidence:'Persisted legacy fact.',content_hash:hash('Persisted legacy fact.'),risk_level:'low',status:'pending_review',created_at:at});
 }
 const sql=`-- Schema v${version}; source ${commit}${version===12?'; reconstructed v12 boundary (no committed v12 schema)':''}\n`+definitions.map(row=>row.sql+';').join('\n\n')+'\n\n'+seed.join('\n')+'\n';
 const file=`v${version}.sql`;writeFileSync(`${out}/${file}`,sql);
 manifest.push({version,file,sourceCommit:commit,sourceHash:hash(original),fixtureHash:hash(sql),provenance:version===12?'reconstructed_boundary':'historical_committed_schema'});
 db.close();
}
writeFileSync(`${out}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
console.log(`Generated ${manifest.length} migration fixtures (v12 explicitly reconstructed).`);
