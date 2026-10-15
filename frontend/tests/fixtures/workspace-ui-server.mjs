/** Loopback-only synthetic HTTP fixture for visual QA of the real workspace.
 * node --experimental-strip-types tests/fixtures/workspace-ui-server.mjs
 * No database, cloud calls, credentials, microphone or model. Mutations denied.
 */
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mockLangGraphAPI } from '../e2e/utils/mock-api.ts';

const port = 4321;
const threadId = '50000000-0000-4000-8000-000000000031';
const tenantId = '10000000-0000-4000-8000-000000000031';
const matterId = '30000000-0000-4000-8000-000000000031';
const membershipId = '20000000-0000-4000-8000-000000000031';
const evidenceId = '60000000-0000-4000-8000-000000000031';
const versionId = '70000000-0000-4000-8000-000000000031';
const now = '2026-10-15T07:00:00Z';
const base = `/api/law/tenants/${tenantId}/matters/${matterId}`;
const matter = { id: matterId, tenant_id: tenantId, title: '合成界面验收案件', kind: 'case', case_number:'SYNTHETIC-UI-ONLY', status:'active', stage:'intake', classification:'ordinary', version:1, created_by_membership_id: membershipId, created_at:now,updated_at:now };
const context = { user_id:'default',tenant_id:tenantId,matter_id:matterId,membership_id:membershipId,tenant_role:'owner',matter_member_id:'member',matter_role:'owner',work_kind:'case',thread_id:threadId,mapping_id:'mapping',policy_version:'ui-fixture',context_version:1 };
const evidence = {id:evidenceId,tenant_id:tenantId,matter_id:matterId,title:'01-合成庭审录音.wav',kind:'evidence',status:'active',version:1,created_by_membership_id:membershipId,created_at:now,updated_at:now,archived_at:null};
const tasks = [31,32].map((number,index)=>({id:`80000000-0000-4000-8000-0000000000${number}`,tenant_id:tenantId,matter_id:matterId,evidence_item_id:evidenceId,evidence_version_id:versionId,source_sha256:'a'.repeat(64),media_type:'audio/wav',requested_by_membership_id:membershipId,status:index?'queued':'awaiting_review',attempts:1,current_version_number:index?0:1,model_id:'synthetic-no-model',error_code:null,cancel_requested:false,created_at:now,updated_at:now}));
const text='这是用于界面验收的合成录音。本次记录不包含真实案件材料。\n记录日期为二〇二六年十月十五日。请对照原音频复核时间范围。';
const split=text.indexOf('\n');
const transcript={schemaVersion:1,offsetUnit:'utf16',text,durationMs:80000,reviewStatus:'unreviewed',approxAlignment:true,warnings:['synthetic_fixture'],segments:[{text:text.slice(0,split),charStart:0,charEnd:split,startMs:0,endMs:36000,speakerId:'spk_0'},{text:text.slice(split+1),charStart:split+1,charEnd:text.length,startMs:36000,endMs:80000,speakerId:'spk_1'}],speakers:[{id:'spk_0',label:'说话人 1'},{id:'spk_1',label:'说话人 2'}]};
const graph={format:'matrix-law.legal-graph',schema_version:1,title:'合成案情图谱',nodes:[{id:'party1',label:'合成甲公司',type:'org',category:'person',source_ids:[]},{id:'party2',label:'合成乙公司',type:'org',category:'person',source_ids:[]},{id:'contract',label:'合成合同',type:'evidence',category:'evidence',source_ids:[]}],edges:[{id:'e1',source:'party1',target:'contract',label:'签订',category:'evidence',confidence:'INFERRED',source_ids:[]},{id:'e2',source:'party2',target:'contract',label:'签订',category:'evidence',confidence:'INFERRED',source_ids:[]}],sources:[]};
const documents=[{id:'ui-note',kind:'document',title:'材料核对说明',filename:'材料核对说明.md',media:'text/markdown',body:'# 材料核对说明\n\n本说明仅用于合成界面验收。\n\n## 一、材料范围\n\n请核对原件、文字及来源版本。\n\n## 二、后续安排\n\n完成核对后提交审核。\n'},{id:'ui-graph',kind:'knowledge_graph',title:'合成案情图谱',filename:'合成案情.law-graph.json',media:'application/json',body:JSON.stringify(graph)}];
const version=(item)=>({id:`${item.id}-v1`,tenant_id:tenantId,matter_id:matterId,project_artifact_id:item.id,version_number:1,source_thread_id:threadId,source_artifact_path:null,source_revision_sha256:createHash('sha256').update(item.body).digest('hex'),source_provenance:'client_asserted',derived_from_version_id:null,source_manifest:null,original_filename:item.filename,media_type:item.media,byte_size:Buffer.byteLength(item.body),sha256:createHash('sha256').update(item.body).digest('hex'),scan_status:'clean',scanned_at:now,review_status:'unreviewed',created_at:now});
const routes=[];
mockLangGraphAPI({route:(pattern,handler)=>{routes.push({pattern,handler});return Promise.resolve();}}, {threads:[{thread_id:threadId,title:'材料校对',artifacts:[],messages:[{type:'human',id:'ui-h',content:'请打开测试记录，帮我核对识别文字。'},{type:'ai',id:'ui-a',content:'原件和校对稿可以在右侧工作区打开。\n\n本页面使用真实前端组件与合成 HTTP 接口，仅供界面检查。'}]}],features:{browserControlEnabled:false},skills:[]});
const matches=(pattern,url)=>pattern instanceof RegExp?pattern.test(url):new RegExp('^'+pattern.split('**').map(part=>part.split('*').map(bit=>bit.replace(/[.+?^${}()|[\]\\]/g,'\\$&')).join('[^/]*')).join('.*')+'$').test(url);
http.createServer(async(req,res)=>{
 const origin=req.headers.origin;
 if(origin && !['http://127.0.0.1:4320','http://localhost:4320'].includes(origin)){res.writeHead(403);res.end();return;}
 if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Credentials','true');}
 res.setHeader('Access-Control-Allow-Headers','Content-Type,X-CSRF-Token,Idempotency-Key,X-Content-SHA256');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
 res.setHeader('Cache-Control','no-store');
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 const url=new URL(req.url,`http://127.0.0.1:${port}`);const path=url.pathname;
 let raw='';for await(const chunk of req) {raw+=chunk;if(raw.length>1048576){res.writeHead(413);res.end();return;}}
 const reply=(body,status=200,type='application/json',raw=false)=>{res.writeHead(status,{'Content-Type':type});res.end(raw?body:type==='application/json'?JSON.stringify(body):body);};
 const law=(data)=>reply({data,meta:{request_id:'synthetic-ui-only'}});
 if(req.method!=='GET' && !path.endsWith('/search') && !path.endsWith('/history')){console.log('Blocked synthetic write:',req.method,path);reply({detail:'Synthetic visual fixture: writes are disabled.'},403);return;}
 if(path==='/api/law/tenants')return law({items:[{tenant:{id:tenantId,slug:'synthetic-ui-only',name:'界面验收试用律所',status:'active',version:1,created_at:now,updated_at:now},membership:{id:membershipId,tenant_id:tenantId,user_id:'default',role:'owner',status:'active',display_name:'演示账号',version:1}}]});
 if(path.includes('/context/by-thread/'))return law({context});
 if(path.endsWith('/matters'))return law({items:[matter]});
 if(path===base)return law({matter});
 if(path===base+'/threads')return law({items:[{id:'mapping',thread_id:threadId,matter_id:matterId,tenant_id:tenantId,status:'active',version:1,created_by_membership_id:membershipId,created_at:now}]});
 if(path.includes('/evidence/') && path.endsWith('/content')) { const media=Buffer.alloc(44+16000*2*80);media.write('RIFF');media.writeUInt32LE(media.length-8,4);media.write('WAVEfmt ',8);media.writeUInt32LE(16,16);media.writeUInt16LE(1,20);media.writeUInt16LE(1,22);media.writeUInt32LE(16000,24);media.writeUInt32LE(32000,28);media.writeUInt16LE(2,32);media.writeUInt16LE(16,34);media.write('data',36);media.writeUInt32LE(media.length-44,40);return reply(media,200,'audio/wav'); }
 if(path===base+'/legal-hold')return law({active:false,matter_version:1,current_placement:null,events:[]});
 if(path===base+'/members')return law({items:[]});
 if(path===base+'/case-workbench')return law({revision:1,matter,permissions:{can_edit:true,can_review_documents:true,member_role:'owner'},statistics:{evidence_items:1,derived_artifacts:2,clean_scanned_current_materials:1,pending_document_reviews:2,current_artifacts:[],overdue_confirmed_deadlines:0,confirmed_deadlines_next_7_days:0,confirmed_internal_tasks:0,completed_internal_tasks:0,proposed_deadlines:0},upcoming_deadlines:[],recent_activity:[],generated_at:now});
 if(path===base+'/case-workbench/deadlines')return law({items:[],total:0,limit:25,offset:0,next_offset:null});
 if(path===base+'/case-workbench/events'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(': synthetic UI heartbeat\n\n');const timer=setInterval(()=>res.write(': heartbeat\n\n'),30000);res.on('close',()=>clearInterval(timer));return;}
 if(path===base+'/evidence')return law({items:[evidence]});
 if(path.endsWith('/evidence/'+evidenceId+'/versions'))return law({items:[{id:versionId,evidence_item_id:evidenceId,version_number:1,original_filename:evidence.title,media_type:'audio/wav',byte_size:44,sha256:'a'.repeat(64),scan_status:'clean',scanned_at:now,created_at:now}]});
 if(path.endsWith('/speech-transcriptions'))return law({items:tasks,transcription_available:true,supported_media_types:['audio/wav','audio/mpeg'],live_capture_available:false,live_capture_media_types:[]});
 if(path.includes('/speech-transcriptions/')){const task=tasks.find(item=>path.endsWith(item.id)); if(task)return law({task,versions:task.current_version_number?[{id:'speech-v1',task_id:task.id,version_number:1,origin:'asr',source_sha256:task.source_sha256,transcript,created_at:now}]:[],events:[]});}
 if(path.endsWith('/speech-citations'))return law({items:[]});
 if(path===base+'/project-artifacts')return law({items:documents.map(item=>({id:item.id,tenant_id:tenantId,matter_id:matterId,kind:item.kind,title:item.title,status:'active',current_version_number:1,version:1,created_at:now,updated_at:now}))});
 for(const item of documents){
  if(path.endsWith(`/project-artifacts/${item.id}/versions`))return law({items:[version(item)]});
  if(path.includes(`/project-artifacts/${item.id}/versions/`) && path.endsWith('/content'))return reply(item.body,200,item.media,true);
  if(path.includes(`/project-artifacts/${item.id}/versions/`) && path.endsWith('/reviews'))return law({items:[]});
  if(path.includes(`/project-artifacts/${item.id}/versions/`) && path.endsWith('/sources'))return law({source_state:'unbound',source_manifest:{citations:[],authorities:[]}});
 }
 if(path.startsWith('/api/law/'))return reply({error:{code:'SYNTHETIC_ENDPOINT_NOT_CONFIGURED',message:'此本地界面夹具尚未配置该接口。'}},404);
 for(let index=routes.length-1;index>=0;index--){const registered=routes[index];if(!matches(registered.pattern,url.href))continue;let fallback=false;
  await registered.handler({request:()=>({url:()=>url.href,method:()=>req.method,postDataJSON:()=>JSON.parse(raw||'null'),postData:()=>raw,headers:()=>req.headers}),fulfill:async(options)=>{reply(options.json??(options.body?JSON.parse(options.body):null),options.status??200);},fallback:async()=>{fallback=true;}});
  if(!fallback)return;
 }
 reply({detail:'Unconfigured synthetic fixture endpoint'},404);
}).listen(port,'127.0.0.1',()=>console.log(`Synthetic UI fixture on 127.0.0.1:${port}; writes disabled.\nWorkspace: http://127.0.0.1:4320/workspace/chats/${threadId}`));
